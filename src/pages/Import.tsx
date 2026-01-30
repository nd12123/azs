import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

// Normalize header: trim, collapse whitespace, lowercase
function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Map NORMALIZED Excel column headers to database fields
// All keys must be lowercase with single spaces
// Supports both English and Russian headers
const COLUMN_MAP: Record<string, string> = {
  // station_no
  'station_no': 'station_no',
  'station no': 'station_no',
  'station number': 'station_no',
  '№азс': 'station_no',
  '№ азс': 'station_no',
  'номер азс': 'station_no',

  // npo
  'npo': 'npo',
  'нпо': 'npo',

  // address
  'address': 'address',
  'адрес': 'address',
  'адрес азс': 'address',

  // region
  'region': 'region',
  'регион': 'region',

  // location_type
  'location_type': 'location_type',
  'location type': 'location_type',
  'расположение азс: город/трасса/прочая территория': 'location_type',
  'расположение': 'location_type',
  'тип расположения': 'location_type',

  // station_phone
  'station_phone': 'station_phone',
  'station phone': 'station_phone',
  'phone': 'station_phone',
  'номер телефона азс': 'station_phone',
  'телефон азс': 'station_phone',

  // station_email
  'station_email': 'station_email',
  'station email': 'station_email',
  'email': 'station_email',
  'электронный адрес азс/ lotus': 'station_email',
  'электронный адрес азс': 'station_email',
  'email азс': 'station_email',

  // manager_name
  'manager_name': 'manager_name',
  'manager name': 'manager_name',
  'manager': 'manager_name',
  'менеджер азс фио': 'manager_name',
  'менеджер азс': 'manager_name',
  'фио менеджера': 'manager_name',

  // manager_phone
  'manager_phone': 'manager_phone',
  'manager phone': 'manager_phone',
  'номер телефона менеджера азс': 'manager_phone',
  'телефон менеджера': 'manager_phone',

  // territory_manager_name
  'territory_manager_name': 'territory_manager_name',
  'territory manager name': 'territory_manager_name',
  'territory manager': 'territory_manager_name',
  'территориальный менеджер фио': 'territory_manager_name',
  'территориальный менеджер': 'territory_manager_name',

  // territory_manager_phone
  'territory_manager_phone': 'territory_manager_phone',
  'territory manager phone': 'territory_manager_phone',
  'телефон территориального менеджера': 'territory_manager_phone',

  // price_category
  'price_category': 'price_category',
  'price category': 'price_category',
  'ценовая категория бгн': 'price_category',
  'ценовая категория': 'price_category',

  // menu
  'menu': 'menu',
  'действующее меню (petronics)': 'menu',
  'меню': 'menu',

  // sales_day_1
  'sales_day_1': 'sales_day_1',
  'sales day 1': 'sales_day_1',
  'реализация в день 1': 'sales_day_1',

  // sales_day_2
  'sales_day_2': 'sales_day_2',
  'sales day 2': 'sales_day_2',
  'реализация в день 2': 'sales_day_2',

  // sales_day_3
  'sales_day_3': 'sales_day_3',
  'sales day 3': 'sales_day_3',
  'реализация в день 3': 'sales_day_3',

  // luk_cafe
  'luk_cafe': 'luk_cafe',
  'luk cafe': 'luk_cafe',
  'lukcafe': 'luk_cafe',
  'лук кафе': 'luk_cafe',
  'луккафе': 'luk_cafe',
  'признак lukcafe': 'luk_cafe',
  'признак luk cafe': 'luk_cafe',
};

// Fields that should always be treated as text (preserve leading zeros)
const TEXT_FIELDS = new Set([
  'station_no',
  'station_phone',
  'manager_phone',
  'territory_manager_phone',
]);

// Fields that should be numeric
const NUMERIC_FIELDS = new Set(['sales_day_1', 'sales_day_2', 'sales_day_3']);

// Fields that should be boolean
const BOOLEAN_FIELDS = new Set(['luk_cafe']);

/**
 * Parse Excel cell value to boolean for luk_cafe and similar fields.
 * - "X", "x", "✓", "да", "yes", "true", 1 → true
 * - "", null, undefined, "нет", "no", "false", 0 → false
 *
 * This is explicit conversion, not relying on JS truthiness.
 */
function parseBooleanField(value: unknown): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value === 'number') {
    return value === 1;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  let str = String(value).trim().toLowerCase();

  if (str === '') return false;

  // Normalize Cyrillic "х" → Latin "x"
  str = str.replace(/х/g, 'x'); // IMPORTANT: Cyrillic char

  const truthyValues = new Set([
    'x',
    '✓',
    '✔',
    'да',
    'yes',
    'true',
    '1',
  ]);

  return truthyValues.has(str);
}

interface ImportResult {
  success: boolean;
  imported: number;
  errors: string[];
}

function normalizeValue(dbField: string, value: unknown): unknown {
  // Boolean fields - must be handled BEFORE null check
  // because empty string should become false, not null
  if (BOOLEAN_FIELDS.has(dbField)) {
    return parseBooleanField(value);
  }

  // Handle null/undefined/empty
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // Numeric fields
  if (NUMERIC_FIELDS.has(dbField)) {
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    return isNaN(num) ? null : num;
  }

  // Text fields - always convert to string, preserve as-is
  if (TEXT_FIELDS.has(dbField)) {
    return String(value).trim();
  }

  // All other fields - convert to string
  return String(value).trim();
}

function mapRowToStation(row: Record<string, unknown>, rowIndex: number): Record<string, unknown> | null {
  const station: Record<string, unknown> = {
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  // Debug: log headers on first row
  if (rowIndex === 0) {
    console.log('Excel headers:', Object.keys(row));
    console.log('Normalized headers:', Object.keys(row).map(h => `"${normalizeHeader(h)}"`));
    console.log('First row values:', row);
  }

  for (const [excelCol, rawValue] of Object.entries(row)) {
    const normalized = normalizeHeader(excelCol);
    const dbField = COLUMN_MAP[normalized];
    if (!dbField) {
      if (rowIndex === 0) console.log(`Unmapped header: "${excelCol}" -> "${normalized}"`);
      continue;
    }

    const value = normalizeValue(dbField, rawValue);
    if (value !== null) {
      station[dbField] = value;
    }
  }

  // Ensure boolean fields have explicit values (default to false if missing)
  if (station.luk_cafe === undefined) {
    station.luk_cafe = false;
  }

  // Validate required field
  const stationNo = station.station_no;

  if (typeof stationNo !== 'string' || stationNo.trim() === '') {
    console.warn(`Row ${rowIndex + 2}: skipped (missing station_no)`);
    console.warn(`  Mapped fields:`, Object.keys(station));
    console.warn(`  station.station_no value:`, station.station_no);
    return null;
  }

  return station;
}

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function parseExcel(data: string): Record<string, unknown>[] {
    const workbook = XLSX.read(data, {
      type: 'binary',
      // Force all cells to be read as strings to preserve leading zeros
      raw: false,
      cellText: true,
    });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Use raw: false and defval to get string values
    return XLSX.utils.sheet_to_json(sheet, {
      raw: false, // Don't parse numbers, keep as formatted strings
      defval: '', // Default value for empty cells
    }) as Record<string, unknown>[];
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = event.target?.result as string;
      const rows = parseExcel(data);
      setPreview(rows.slice(0, 5));
    };
    reader.readAsBinaryString(selectedFile);
  }

  async function handleImport() {
    if (!file) return;

    // Confirmation dialog before destructive action
    const confirmed = window.confirm(
      'Это действие деактивирует все существующие станции и заменит их данными из файла.\n\nПродолжить?'
    );
    if (!confirmed) return;

    setImporting(true);
    setResult(null);

    const errors: string[] = [];
    let imported = 0;

    try {
      // 1. Read and parse Excel
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsBinaryString(file);
      });

      const rows = parseExcel(data);

      if (rows.length === 0) {
        throw new Error('Excel file is empty');
      }

      // 2. Normalize all rows first
      const stations: Record<string, unknown>[] = [];
      for (let i = 0; i < rows.length; i++) {
        const station = mapRowToStation(rows[i], i);
        if (!station) {
          errors.push(`Row ${i + 2}: Missing or invalid station_no`);
          continue;
        }
        stations.push(station);
      }

      if (stations.length === 0) {
        throw new Error('No valid stations found in Excel file');
      }

      // 3. Mark all existing stations as inactive
      // Use tautological WHERE to satisfy PostgREST requirement
      const { error: deactivateError } = await supabase
        .from('stations')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (deactivateError) {
        throw new Error(`Failed to deactivate stations: ${deactivateError.message}`);
      }
      // Count will be shown after import completes

      // 4. Upsert in batches of 100 for better performance
      const BATCH_SIZE = 100;
      for (let i = 0; i < stations.length; i += BATCH_SIZE) {
        const batch = stations.slice(i, i + BATCH_SIZE);

        const { error: upsertError } = await supabase
          .from('stations')
          .upsert(batch, {
            onConflict: 'station_no',
            ignoreDuplicates: false,
          });

        if (upsertError) {
          // If batch fails, try one by one to identify problematic rows
          for (let j = 0; j < batch.length; j++) {
            const station = batch[j];
            const { error: singleError } = await supabase
              .from('stations')
              .upsert(station, { onConflict: 'station_no' });

            if (singleError) {
              const rowNum = i + j + 2; // +2 for header and 0-index
              errors.push(`Row ${rowNum} (${station.station_no}): ${singleError.message}`);
            } else {
              imported++;
            }
          }
        } else {
          imported += batch.length;
        }
      }

      setResult({
        success: errors.length === 0,
        imported,
        errors,
      });
    } catch (err) {
      setResult({
        success: false,
        imported: 0,
        errors: [err instanceof Error ? err.message : 'Unknown error'],
      });
    }

    setImporting(false);
  }

  function reset() {
    setFile(null);
    setPreview([]);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  return (
    <div className="import-page">
      <h1>Import Stations</h1>
      <p className="import-description">
        Upload an Excel file to update the stations database. All existing
        stations will be marked as inactive, then the uploaded data will be
        imported.
      </p>

      {!result && (
        <>
          <div className="file-upload">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={importing}
            />
          </div>

          {preview.length > 0 && (
            <div className="preview">
              <h3>Preview (first 5 rows)</h3>
              <div className="preview-table-wrapper">
                <table className="preview-table">
                  <thead>
                    <tr>
                      {Object.keys(preview[0]).map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val, j) => (
                          <td key={j}>{String(val ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={handleImport}
                disabled={importing}
                className="import-btn"
              >
                {importing ? 'Импорт...' : 'Импортировать данные'}
              </button>
              {importing && (
                <div className="import-progress">
                  <div className="spinner" />
                  <span>Обработка данных, пожалуйста подождите...</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {result && (
        <div className={`import-result ${result.success ? 'success' : 'error'}`}>
          <h3>
            {result.success
              ? 'Импорт завершён'
              : 'Импорт завершён с ошибками'}
          </h3>
          <p>Импортировано станций: {result.imported}</p>

          {result.imported === 0 && result.errors.length === 0 && (
            <div className="warning-message">
              Внимание: файл не содержит валидных данных для импорта.
              Проверьте формат файла и названия колонок.
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="error-list">
              <h4>Ошибки ({result.errors.length})</h4>
              <ul>
                {result.errors.slice(0, 20).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {result.errors.length > 20 && (
                  <li>... и ещё {result.errors.length - 20} ошибок</li>
                )}
              </ul>
            </div>
          )}

          <button onClick={reset} className="reset-btn">
            Импортировать другой файл
          </button>
        </div>
      )}
    </div>
  );
}
