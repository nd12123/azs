import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Station } from '../types';

export default function Stations() {
  const [stations, setStations] = useState<Station[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadStations();
  }, []);

  async function loadStations() {
    setLoading(true);
    setError('');

    // PostgREST has a max limit of 1000 rows per request
    // Fetch in batches to get up to 3000 rows total
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 3;
    const allStations: Station[] = [];

    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        const { data, error } = await supabase
          .from('stations')
          .select('*')
          .eq('is_active', true)
          .order('station_no')
          .range(from, to);

        if (error) {
          throw error;
        }

        if (data) {
          allStations.push(...data);
        }

        // Stop if we got fewer than PAGE_SIZE (no more data)
        if (!data || data.length < PAGE_SIZE) {
          break;
        }
      }

      setStations(allStations);
    } catch (err) {
      setError('Ошибка загрузки станций');
      console.error(err);
    }

    setLoading(false);
  }

  // Filter stations by search term (station_no)
  const filtered = stations.filter((s) =>
    s.station_no.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <span>Загрузка станций...</span>
      </div>
    );
  }

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  return (
    <div className="stations-page">
      <div className="search-bar">
        <input
          type="search"
          inputMode="numeric"
          placeholder="Введите номер АЗС"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      <div className="stations-count">
        Найдено станций: {filtered.length}
      </div>

      <div className="stations-list">
        {filtered.map((station) => (
          <Link
            key={station.id}
            to={`/station/${station.station_no}`}
            className="station-card"
          >
            <div className="station-no">{station.station_no}</div>
            <div className="station-info">
              {station.npo && <span className="npo">{station.npo}</span>}
              {station.region && <span className="region">{station.region}</span>}
            </div>
            {station.address && (
              <div className="station-address">{station.address}</div>
            )}
          </Link>
        ))}

        {filtered.length === 0 && (
          <div className="no-results">
            {search
              ? `По запросу "${search}" ничего не найдено`
              : 'Станции не найдены'}
          </div>
        )}
      </div>
    </div>
  );
}
