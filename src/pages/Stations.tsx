import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Station } from '../types';

export default function Stations() {
  const [stations, setStations] = useState<Station[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [selectedNpo, setSelectedNpo] = useState<string[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string[]>([]);
  const [selectedLocationType, setSelectedLocationType] = useState<string[]>([]);
  const [selectedRegionalManager, setSelectedRegionalManager] = useState<string[]>([]);
  const [lukCafeFilter, setLukCafeFilter] = useState(false);

  const filterRef = useRef<HTMLDivElement>(null);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number>(0);
  const touchCurrentY = useRef<number>(0);

  // Swipe-to-close handler for mobile filter sheet
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchCurrentY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    touchCurrentY.current = e.touches[0].clientY;
    const diff = touchCurrentY.current - touchStartY.current;

    // Only allow dragging down, and only from the header area
    if (diff > 0 && filterPopoverRef.current) {
      filterPopoverRef.current.style.transform = `translateY(${diff}px)`;
      filterPopoverRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const diff = touchCurrentY.current - touchStartY.current;

    if (filterPopoverRef.current) {
      filterPopoverRef.current.style.transition = 'transform 0.25s ease-out';

      // If swiped down more than 80px, close the filter
      if (diff > 80) {
        filterPopoverRef.current.style.transform = 'translateY(100%)';
        setTimeout(() => setShowFilters(false), 250);
      } else {
        filterPopoverRef.current.style.transform = 'translateY(0)';
      }
    }
  }, []);

  useEffect(() => {
    loadStations();
  }, []);

  // Close filter popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilters(false);
      }
    }
    if (showFilters) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilters]);

  // Lock body scroll when filter popover is open on mobile (iOS Safari compatible)
  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    if (showFilters && isMobile) {
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [showFilters]);

  async function loadStations() {
    setLoading(true);
    setError('');

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

  // Extract unique filter values from stations
  const filterOptions = useMemo(() => {
    const npoSet = new Set<string>();
    const regionSet = new Set<string>();
    const locationTypeSet = new Set<string>();
    const regionalManagerSet = new Set<string>();

    stations.forEach((s) => {
      if (s.npo) npoSet.add(s.npo);
      if (s.region) regionSet.add(s.region);
      if (s.location_type) locationTypeSet.add(s.location_type);
      if (s.regional_manager_name) regionalManagerSet.add(s.regional_manager_name);
    });

    return {
      npo: Array.from(npoSet).sort(),
      region: Array.from(regionSet).sort(),
      locationType: Array.from(locationTypeSet).sort(),
      regionalManager: Array.from(regionalManagerSet).sort(),
    };
  }, [stations]);

  // Filter stations by search term and selected filters
  const filtered = useMemo(() => {
    return stations.filter((s) => {
      // Search filter
      if (search && !s.station_no.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      
      // LukCafe filter
      if (lukCafeFilter && !s.luk_cafe) {
        return false;
      }

      // NPO filter
      if (selectedNpo.length > 0 && (!s.npo || !selectedNpo.includes(s.npo))) {
        return false;
      }

      // Region filter
      if (selectedRegion.length > 0 && (!s.region || !selectedRegion.includes(s.region))) {
        return false;
      }

      // Location type filter
      if (selectedLocationType.length > 0 && (!s.location_type || !selectedLocationType.includes(s.location_type))) {
        return false;
      }

      // Regional manager filter
      if (selectedRegionalManager.length > 0 && (!s.regional_manager_name || !selectedRegionalManager.includes(s.regional_manager_name))) {
        return false;
      }


      return true;
    });
  }, [stations, search, selectedNpo, selectedRegion, selectedLocationType, selectedRegionalManager, lukCafeFilter]);

  // Check if any filters are active
  const hasActiveFilters = selectedNpo.length > 0 || selectedRegion.length > 0 || selectedLocationType.length > 0 || selectedRegionalManager.length > 0 || lukCafeFilter;

  // Toggle chip selection
  function toggleChip(value: string, selected: string[], setSelected: (v: string[]) => void) {
    if (selected.includes(value)) {
      setSelected(selected.filter((v) => v !== value));
    } else {
      setSelected([...selected, value]);
    }
  }

  // Clear all filters
  function clearFilters() {
    setLukCafeFilter(false);
    setSelectedNpo([]);
    setSelectedRegion([]);
    setSelectedLocationType([]);
    setSelectedRegionalManager([]);
    //setPlaceholderFilter(false);
  }

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
      {/* Search bar with filter button */}
      <div className="search-filter-row">
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

        {/* Filter button */}
        <div className="filter-container" ref={filterRef}>
          <button
            className={`filter-btn ${hasActiveFilters ? 'has-filters' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
            aria-label="Фильтры"
          >
            <FilterIcon />
            {hasActiveFilters && <span className="filter-badge" />}
          </button>

          {/* Filter Popover / Bottom Sheet */}
          {showFilters && (
            <>
            <div className="filter-overlay" onClick={() => setShowFilters(false)} />
            <div className="filter-popover" ref={filterPopoverRef}>
              <div
                className="filter-header"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                <span className="filter-title">Фильтры</span>
                {hasActiveFilters && (
                  <button className="clear-filters-btn" onClick={clearFilters}>
                    Сбросить
                  </button>
                )}
              </div>

              {/* Boolean Filters */}
              <div className="filter-section">
                <div className="filter-section-title">Фильтр по признаку</div>
                <label className="placeholder-filter">
                  <input
                    type="checkbox"
                    checked={lukCafeFilter}
                    onChange={(e) => setLukCafeFilter(e.target.checked)}
                  />
                  <span>LukCafe</span>
                </label>
                {
                  /**
                <label className="placeholder-filter">
                  <input
                    type="checkbox"
                    checked={placeholderFilter}
                    onChange={(e) => setPlaceholderFilter(e.target.checked)}
                  />
                  <span>Включить (в разработке)</span>
                </label> */
                }
              </div>

              {/* NPO Filter */}
              {filterOptions.npo.length > 0 && (
                <FilterSection
                  title="НПО"
                  options={filterOptions.npo}
                  selected={selectedNpo}
                  onToggle={(v) => toggleChip(v, selectedNpo, setSelectedNpo)}
                />
              )}

              {/* Region Filter */}
              {filterOptions.region.length > 0 && (
                <FilterSection
                  title="Регион"
                  options={filterOptions.region}
                  selected={selectedRegion}
                  onToggle={(v) => toggleChip(v, selectedRegion, setSelectedRegion)}
                />
              )}

              {/* Location Type Filter */}
              {filterOptions.locationType.length > 0 && (
                <FilterSection
                  title="Тип локации"
                  options={filterOptions.locationType}
                  selected={selectedLocationType}
                  onToggle={(v) => toggleChip(v, selectedLocationType, setSelectedLocationType)}
                />
              )}

              {/* Regional Manager Filter */}
              {filterOptions.regionalManager.length > 0 && (
                <FilterSection
                  title="Региональный управляющий"
                  options={filterOptions.regionalManager}
                  selected={selectedRegionalManager}
                  onToggle={(v) => toggleChip(v, selectedRegionalManager, setSelectedRegionalManager)}
                />
              )}

            </div>
            </>
          )}
        </div>
      </div>

      {/* Active filters display */}
      {hasActiveFilters && (
        <div className="active-filters">
          {selectedNpo.map((v) => (
            <span key={`npo-${v}`} className="active-chip" onClick={() => toggleChip(v, selectedNpo, setSelectedNpo)}>
              {v} ×
            </span>
          ))}
          {selectedRegion.map((v) => (
            <span key={`region-${v}`} className="active-chip" onClick={() => toggleChip(v, selectedRegion, setSelectedRegion)}>
              {v} ×
            </span>
          ))}
          {selectedLocationType.map((v) => (
            <span key={`loc-${v}`} className="active-chip" onClick={() => toggleChip(v, selectedLocationType, setSelectedLocationType)}>
              {v} ×
            </span>
          ))}
          {selectedRegionalManager.map((v) => (
            <span key={`rm-${v}`} className="active-chip" onClick={() => toggleChip(v, selectedRegionalManager, setSelectedRegionalManager)}>
              {v} ×
            </span>
          ))}
          {lukCafeFilter && (
            <span className="active-chip" onClick={() => setLukCafeFilter(false)}>
              LukCafe ×
            </span>
          )}
        </div>
      )}

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
            {search || hasActiveFilters
              ? 'По заданным критериям ничего не найдено'
              : 'Станции не найдены'}
          </div>
        )}
      </div>
    </div>
  );
}

// Filter Section Component
function FilterSection({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="filter-section">
      <div className="filter-section-title">{title}</div>
      <div className="filter-chips">
        {options.map((option) => (
          <button
            key={option}
            className={`filter-chip ${selected.includes(option) ? 'selected' : ''}`}
            onClick={() => onToggle(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

// Filter Icon Component
function FilterIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
