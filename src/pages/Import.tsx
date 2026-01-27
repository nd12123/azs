import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

// Map Excel column headers to database fields
// Adjust these mappings based on your actual Excel column names
const COLUMN_MAP: Record<string, string> = {
  'station_no': 'station_no',
  'Station No': 'station_no',
  'npo': 'npo',
  'NPO': 'npo',
  'address': 'address',
  'Address': 'address',
  'region': 'region',
  'Region': 'region',
  'location_type': 'location_type',
  'Location Type': 'location_type',
  'station_phone': 'station_phone',
  'Station Phone': 'station_phone',
  'Phone': 'station_phone',
  'station_email': 'station_email',
  'Station Email': 'station_email',
  'Email': 'station_email',
  'manager_name': 'manager_name',
  'Manager Name': 'manager_name',
  'Manager': 'manager_name',
  'manager_phone': 'manager_phone',
  'Manager Phone': 'manager_phone',
  'territory_manager_name': 'territory_manager_name',
  'Territory Manager Name': 'territory_manager_name',
  'Territory Manager': 'territory_manager_name',
  'territory_manager_phone': 'territory_manager_phone',
  'Territory Manager Phone': 'territory_manager_phone',
  'price_category': 'price_category',
  'Price Category': 'price_category',
  'menu': 'menu',
  'Menu': 'menu',
  'sales_day_1': 'sales_day_1',
  'Sales Day 1': 'sales_day_1',
  'sales_day_2': 'sales_day_2',
  'Sales Day 2': 'sales_day_2',
  'sales_day_3': 'sales_day_3',
  'Sales Day 3': 'sales_day_3',
};

interface ImportResult {
  success: boolean;
  imported: number;
  errors: string[];
}

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setResult(null);

    // Parse Excel for preview
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = event.target?.result;
      const workbook = XLSX.read(data, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet);

      // Show first 5 rows as preview
      setPreview(json.slice(0, 5) as Record<string, unknown>[]);
    };
    reader.readAsBinaryString(selectedFile);
  }

  function mapRowToStation(row: Record<string, unknown>) {
    const station: Record<string, unknown> = {
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    for (const [excelCol, value] of Object.entries(row)) {
      const dbField = COLUMN_MAP[excelCol];
      if (dbField && value !== undefined && value !== '') {
        // Convert numbers for sales fields
        if (dbField.startsWith('sales_day_')) {
          station[dbField] = typeof value === 'number' ? value : parseFloat(String(value)) || null;
        } else {
          station[dbField] = String(value).trim();
        }
      }
    }

    return station;
  }

  async function handleImport() {
    if (!file) return;

    setImporting(true);
    setResult(null);

    const errors: string[] = [];
    let imported = 0;

    try {
      // 1. Read and parse Excel
      const reader = new FileReader();
      const data = await new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsBinaryString(file);
      });

      const workbook = XLSX.read(data, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

      if (rows.length === 0) {
        throw new Error('Excel file is empty');
      }

      // 2. Mark all stations as inactive
      const { error: deactivateError } = await supabase
        .from('stations')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Match all rows

      if (deactivateError) {
        throw new Error(`Failed to deactivate stations: ${deactivateError.message}`);
      }

      // 3. Upsert each station
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const station = mapRowToStation(row);

        if (!station.station_no) {
          errors.push(`Row ${i + 2}: Missing station_no`);
          continue;
        }

        const { error: upsertError } = await supabase
          .from('stations')
          .upsert(station, { onConflict: 'station_no' });

        if (upsertError) {
          errors.push(`Row ${i + 2} (${station.station_no}): ${upsertError.message}`);
        } else {
          imported++;
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
        Upload an Excel file to update the stations database.
        All existing stations will be marked as inactive, then the uploaded data will be imported.
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
                {importing ? 'Importing...' : 'Import All Data'}
              </button>
            </div>
          )}
        </>
      )}

      {result && (
        <div className={`import-result ${result.success ? 'success' : 'error'}`}>
          <h3>{result.success ? 'Import Complete' : 'Import Completed with Errors'}</h3>
          <p>{result.imported} stations imported successfully</p>

          {result.errors.length > 0 && (
            <div className="error-list">
              <h4>Errors ({result.errors.length})</h4>
              <ul>
                {result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <button onClick={reset} className="reset-btn">
            Import Another File
          </button>
        </div>
      )}
    </div>
  );
}
