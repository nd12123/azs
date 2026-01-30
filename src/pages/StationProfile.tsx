import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Station } from '../types';

type Tab = 'bgn' | 'ff';

export default function StationProfile() {
  const { stationNo } = useParams<{ stationNo: string }>();
  const [station, setStation] = useState<Station | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('bgn');

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
      <Link to="/" className="back-link">← Назад к списку</Link>

      {/* Header row with station number and tabs */}
      <div className="station-header-row">
        <div className="station-header-left">
          <h1>{station.station_no}</h1>
          {station.npo && <div className="npo-badge">{station.npo}</div>}
        </div>
        <div className="profile-tabs-inline">
          <button
            className={`tab-btn-inline ${activeTab === 'bgn' ? 'active' : ''}`}
            onClick={() => setActiveTab('bgn')}
          >
            БГН
          </button>
          <button
            className={`tab-btn-inline ${activeTab === 'ff' ? 'active' : ''}`}
            onClick={() => setActiveTab('ff')}
          >
            ФФ
          </button>
        </div>
      </div>

      {/* Contact Info Block - Always visible on page load */}
      <div className="contact-info-block">
        {/* Address */}
        {station.address && (
          <div className="contact-row">
            <span className="contact-label">Адрес</span>
            <span className="contact-value">
              {station.address}
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="map-link"
                >
                  Карта
                </a>
              )}
            </span>
          </div>
        )}

        {/* Station Phone */}
        {station.station_phone && (
          <div className="contact-row">
            <span className="contact-label">Телефон АЗС</span>
            <a href={`tel:${station.station_phone}`} className="contact-value phone-link">
              {station.station_phone}
            </a>
          </div>
        )}

        {/* Regional Manager */}
        {station.regional_manager_name && (
          <div className="contact-row">
            <span className="contact-label">Рег. менеджер</span>
            <span className="contact-value">{station.regional_manager_name}</span>
          </div>
        )}
        {station.regional_manager_phone && (
          <div className="contact-row">
            <span className="contact-label">Тел. рег. менеджера</span>
            <a href={`tel:${station.regional_manager_phone}`} className="contact-value phone-link">
              {station.regional_manager_phone}
            </a>
          </div>
        )}
      </div>

      {/* Tab Content - Lazy rendered */}
      <div className="tab-content">
        {activeTab === 'bgn' && <BgnTab station={station} />}
        {activeTab === 'ff' && <FfTab station={station} />}
      </div>
    </div>
  );
}

// БГН Tab Component
function BgnTab({ station }: { station: Station }) {
  return (
    <div className="bgn-tab">
      {/* Sales Data - БГН */}
      <div className="sales-block">
        <div className="sales-grid">
          <div className="sales-item">
            <span className="sales-label">Реализация — текущий месяц</span>
            <span className="sales-value">
              {station.sales_day_1 != null ? station.sales_day_1.toLocaleString() : '—'}
            </span>
          </div>
          <div className="sales-item">
            <span className="sales-label">Реализация — пред. месяц</span>
            <span className="sales-value">
              {station.sales_day_2 != null ? station.sales_day_2.toLocaleString() : '—'}
            </span>
          </div>
          <div className="sales-item">
            <span className="sales-label">Реализация — пред. квартал</span>
            <span className="sales-value">
              {station.sales_day_3 != null ? station.sales_day_3.toLocaleString() : '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="data-grid">
        {/* Price Category */}
        <div className="data-item">
          <span className="data-label">Ценовая категория БГН</span>
          <span className="data-value">{station.price_category || '—'}</span>
        </div>

        {/* Menu (Petronics) */}
        <div className="data-item">
          <span className="data-label">Действующее меню (Petronics)</span>
          <span className="data-value">{station.menu || '—'}</span>
        </div>
      </div>
    </div>
  );
}

// ФФ Tab Component
function FfTab({ station: _station }: { station: Station }) {
  // TODO: Replace zeros with proper formula when provided (will use _station data)
  const ffSales1 = 0;
  const ffSales2 = 0;
  const ffSales3 = 0;

  return (
    <div className="ff-tab">
      {/* Sales Data - ФФ (zeros for now, formula TBD) */}
      <div className="sales-block">
        <div className="sales-grid">
          <div className="sales-item">
            <span className="sales-label">Реализация — текущий месяц</span>
            <span className="sales-value">{ffSales1.toLocaleString()}</span>
          </div>
          <div className="sales-item">
            <span className="sales-label">Реализация — пред. месяц</span>
            <span className="sales-value">{ffSales2.toLocaleString()}</span>
          </div>
          <div className="sales-item">
            <span className="sales-label">Реализация — пред. квартал</span>
            <span className="sales-value">{ffSales3.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
