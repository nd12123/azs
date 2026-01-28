// Database types matching your Supabase schema

export interface Station {
  id: string;
  station_no: string;
  npo: string | null;
  address: string | null;
  region: string | null;
  location_type: string | null;
  station_phone: string | null;
  station_email: string | null;
  manager_name: string | null;
  manager_phone: string | null;
  territory_manager_name: string | null;
  territory_manager_phone: string | null;
  regional_manager_name: string | null;
  regional_manager_phone: string | null;
  price_category: string | null;
  menu: string | null;
  sales_day_1: number | null;
  sales_day_2: number | null;
  sales_day_3: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  user_id: string;
  role: 'admin' | 'user';
}
