import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Station } from '../types';

export default function StationProfile() {
  const { stationNo } = useParams<{ stationNo: string }>();
  const [station, setStation] = useState<Station | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (stationNo) {
      loadStation(stationNo);
    }
  }, [stationNo]);

  async function loadStation(no: string) {
    setLoading(true);
    setError('');

    const { data, error } = await supabase
      .from('stations')
      .select('*')
      .eq('station_no', no)
      .eq('is_active', true)
      .single();

    if (error) {
      setError('Station not found');
    } else {
      setStation(data);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <span>Загрузка...</span>
      </div>
    );
  }

  if (error || !station) {
    return (
      <div className="error-page">
        <h2>Станция не найдена</h2>
        <p>Станция не существует или неактивна.</p>
        <Link to="/">← Назад к списку</Link>
      </div>
    );
  }

  // Generate Google Maps link from address
  const mapsUrl = station.address
    ? `https://maps.google.com/?q=${encodeURIComponent(station.address)}`
    : null;

  return (
    <div className="station-profile">
      <Link to="/" className="back-link">&larr; Back to stations</Link>

      <h1>{station.station_no}</h1>
      {station.npo && <div className="npo-badge">{station.npo}</div>}

      <div className="profile-sections">
        {/* Location */}
        <section className="profile-section">
          <h2>Location</h2>
          {station.address && (
            <div className="field">
              <label>Address</label>
              <div>
                {station.address}
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="map-link"
                  >
                    Open in Maps
                  </a>
                )}
              </div>
            </div>
          )}
          {station.region && (
            <div className="field">
              <label>Region</label>
              <div>{station.region}</div>
            </div>
          )}
          {station.location_type && (
            <div className="field">
              <label>Location Type</label>
              <div>{station.location_type}</div>
            </div>
          )}
        </section>

        {/* Contact */}
        <section className="profile-section">
          <h2>Station Contact</h2>
          {station.station_phone && (
            <div className="field">
              <label>Phone</label>
              <a href={`tel:${station.station_phone}`} className="phone-link">
                {station.station_phone}
              </a>
            </div>
          )}
          {station.station_email && (
            <div className="field">
              <label>Email</label>
              <a href={`mailto:${station.station_email}`}>
                {station.station_email}
              </a>
            </div>
          )}
        </section>

        {/* Manager */}
        {(station.manager_name || station.manager_phone) && (
          <section className="profile-section">
            <h2>Manager</h2>
            {station.manager_name && (
              <div className="field">
                <label>Name</label>
                <div>{station.manager_name}</div>
              </div>
            )}
            {station.manager_phone && (
              <div className="field">
                <label>Phone</label>
                <a href={`tel:${station.manager_phone}`} className="phone-link">
                  {station.manager_phone}
                </a>
              </div>
            )}
          </section>
        )}

        {/* Territory Manager */}
        {(station.territory_manager_name || station.territory_manager_phone) && (
          <section className="profile-section">
            <h2>Territory Manager</h2>
            {station.territory_manager_name && (
              <div className="field">
                <label>Name</label>
                <div>{station.territory_manager_name}</div>
              </div>
            )}
            {station.territory_manager_phone && (
              <div className="field">
                <label>Phone</label>
                <a href={`tel:${station.territory_manager_phone}`} className="phone-link">
                  {station.territory_manager_phone}
                </a>
              </div>
            )}
          </section>
        )}

        {/* Business Info */}
        <section className="profile-section">
          <h2>Business Info</h2>
          {station.price_category && (
            <div className="field">
              <label>Price Category</label>
              <div>{station.price_category}</div>
            </div>
          )}
          {station.menu && (
            <div className="field">
              <label>Menu</label>
              <div>{station.menu}</div>
            </div>
          )}
        </section>

        {/* Sales */}
        {(station.sales_day_1 || station.sales_day_2 || station.sales_day_3) && (
          <section className="profile-section">
            <h2>Sales</h2>
            <div className="sales-grid">
              {station.sales_day_1 != null && (
                <div className="sales-item">
                  <label>Day 1</label>
                  <div>{station.sales_day_1.toLocaleString()}</div>
                </div>
              )}
              {station.sales_day_2 != null && (
                <div className="sales-item">
                  <label>Day 2</label>
                  <div>{station.sales_day_2.toLocaleString()}</div>
                </div>
              )}
              {station.sales_day_3 != null && (
                <div className="sales-item">
                  <label>Day 3</label>
                  <div>{station.sales_day_3.toLocaleString()}</div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
