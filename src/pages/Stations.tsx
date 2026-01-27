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

    // RLS ensures only active stations are returned for regular users
    const { data, error } = await supabase
      .from('stations')
      .select('*')
      .eq('is_active', true)
      .order('station_no');

    if (error) {
      setError('Failed to load stations');
      console.error(error);
    } else {
      setStations(data || []);
    }
    setLoading(false);
  }

  // Filter stations by search term (station_no)
  const filtered = stations.filter((s) =>
    s.station_no.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <div className="loading">Loading stations...</div>;
  }

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  return (
    <div className="stations-page">
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search by station number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      <div className="stations-count">
        {filtered.length} station{filtered.length !== 1 ? 's' : ''} found
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
            No stations found{search ? ` matching "${search}"` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
