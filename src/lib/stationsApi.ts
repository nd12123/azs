import type { Station } from '../types'
import { supabase } from './supabase'
import { toFailure, type AppFailure } from './failures'
import { withReadRetries } from './net'
import { collectPages } from './pages'

export type StationListItem = Pick<
  Station,
  | 'id'
  | 'station_no'
  | 'npo'
  | 'address'
  | 'region'
  | 'location_type'
  | 'regional_manager_name'
  | 'luk_cafe'
>

const LIST_COLUMNS =
  'id,station_no,npo,address,region,location_type,regional_manager_name,luk_cafe'

const DETAIL_COLUMNS =
  'id,station_no,npo,address,region,location_type,station_phone,station_email,manager_name,manager_phone,territory_manager_name,territory_manager_phone,regional_manager_name,regional_manager_phone,price_category,menu,sales_day_1,sales_day_2,sales_day_3,luk_cafe,is_active,created_at,updated_at'

interface QueryError {
  message?: string
  code?: string
  details?: string | null
  status?: number
}

function throwQueryError(error: QueryError, status: number | undefined, operation: string): never {
  throw toFailure({ ...error, status: error.status ?? status }, operation, 'read')
}

export async function fetchStationPage(
  from: number,
  to: number,
  signal: AbortSignal,
): Promise<StationListItem[]> {
  return withReadRetries('stations.list', signal, async (attemptSignal) => {
    const { data, error, status } = await supabase
      .from('stations')
      .select(LIST_COLUMNS)
      .eq('is_active', true)
      .order('station_no')
      .range(from, to)
      .abortSignal(attemptSignal)

    if (error) throwQueryError(error, status, 'stations.list')
    return (data ?? []) as StationListItem[]
  })
}

/** Full active directory. Throws instead of returning a partial page set. */
export async function fetchAllActiveStations(signal: AbortSignal): Promise<StationListItem[]> {
  try {
    return await collectPages((from, to, pageSignal) => fetchStationPage(from, to, pageSignal), signal)
  } catch (error) {
    throw toFailure(error, 'stations.list', 'read')
  }
}

export type StationLoad =
  | { status: 'found'; station: Station }
  | { status: 'missing' }
  | { status: 'error'; failure: AppFailure }

export async function fetchStation(stationNo: string, signal: AbortSignal): Promise<StationLoad> {
  try {
    const station = await withReadRetries('stations.detail', signal, async (attemptSignal) => {
      const { data, error, status } = await supabase
        .from('stations')
        .select(DETAIL_COLUMNS)
        .eq('station_no', stationNo)
        .eq('is_active', true)
        .abortSignal(attemptSignal)
        .maybeSingle()

      if (error) throwQueryError(error, status, 'stations.detail')
      return data as Station | null
    })
    if (!station) return { status: 'missing' }
    return { status: 'found', station }
  } catch (error) {
    const failure = toFailure(error, 'stations.detail', 'read')
    if (failure.category === 'aborted') throw failure
    if (failure.category === 'not_found') return { status: 'missing' }
    return { status: 'error', failure }
  }
}
