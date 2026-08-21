'use strict';

/**
 * Export builders for the two download endpoints.
 *
 * Both original exports emitted files named .xls that were not actually Excel
 * binaries: Seva::export_data() streamed tab-separated text, and
 * Import_karyakar::annkut() streamed SpreadsheetML 2003 XML. Excel opens both,
 * so the format is preserved rather than "upgraded" to real xlsx -- that would
 * need a new dependency and would change what downstream consumers receive.
 */

const XML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

/** PHP htmlspecialchars($s, ENT_QUOTES, 'UTF-8'). */
function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/**
 * PHP fputcsv($fh, $fields, "\t").
 *
 * PHP quotes a field when it contains the delimiter, the enclosure, the escape
 * character, CR, LF, TAB, or a SPACE. The space rule is the surprising one and
 * it fires constantly here, because every "Sevak Name" and "Mandal" value has
 * a space in it. A naive join would produce a subtly different file.
 */
function tsvRow(fields) {
  const needsQuote = /["\\\r\n\t ]/;
  const cells = fields.map((field) => {
    const s = field === null || field === undefined ? '' : String(field);
    if (needsQuote.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  });
  return `${cells.join('\t')}\n`;
}

/** Builds the full tab-separated body for Seva::export_data(). */
function buildTsv(headers, rows) {
  let out = tsvRow(headers);
  for (const row of rows) {
    out += tsvRow(headers.map((h) => row[h]));
  }
  return out;
}

/**
 * Builds a SpreadsheetML 2003 workbook.
 *
 * @param {Array<{name: string, columns: Array<{label: string, key: string}>, rows: object[]}>} sheets
 *
 * The PHP version matched header labels to row keys by stripping punctuation
 * and comparing the remainders. That mapping silently failed for the currency
 * columns: header '₹500 Seva' normalised to '500seva' while column
 * 'rs500_seva' normalised to 'rs500seva', so those two cells exported blank on
 * every row. Columns are now bound explicitly by key, which fixes it. See
 * docs/PARITY.md.
 */
function buildSpreadsheetML(sheets) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>';
  xml +=
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"' +
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">';
  xml +=
    '<Styles>' +
    '<Style ss:ID="h"><Font ss:Bold="1"/><Alignment ss:Horizontal="Center"/></Style>' +
    '<Style ss:ID="n"><Alignment ss:Horizontal="Left"/></Style>' +
    '</Styles>';

  for (const sheet of sheets) {
    xml += `<Worksheet ss:Name="${escapeXml(sheet.name)}"><Table>`;

    xml += '<Row>';
    for (const col of sheet.columns) {
      xml += `<Cell ss:StyleID="h"><Data ss:Type="String">${escapeXml(
        col.label
      )}</Data></Cell>`;
    }
    xml += '</Row>';

    for (const row of sheet.rows) {
      xml += '<Row>';
      for (const col of sheet.columns) {
        const value = row[col.key];
        xml += `<Cell ss:StyleID="n"><Data ss:Type="String">${escapeXml(
          value === null || value === undefined ? '' : value
        )}</Data></Cell>`;
      }
      xml += '</Row>';
    }

    xml += '</Table></Worksheet>';
  }

  xml += '</Workbook>';
  return xml;
}

module.exports = { escapeXml, buildTsv, buildSpreadsheetML };
