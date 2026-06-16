export const COLLECTION_CSV_MAX_BYTES = 5 * 1024 * 1024;
export const COLLECTION_CSV_MAX_ROWS = 50000;

const HEADER_ALIASES = {
  name: ["name", "card name", "card_name"],
  set_code: ["set", "set code", "set_code", "edition"],
  collector_number: ["collector number", "collector_number", "collector no", "number"],
  quantity: ["quantity", "qty", "count"],
  finish: ["finish", "foil"],
};

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value.trim());
  return values;
}

function findHeaderIndex(headers, field) {
  return headers.findIndex((header) =>
    HEADER_ALIASES[field].includes(String(header || "").trim().toLowerCase()),
  );
}

function looksLikeHeaderRow(values) {
  const recognizedHeaders = values.filter((value) => {
    const normalizedValue = String(value || "").trim().toLowerCase();

    return Object.values(HEADER_ALIASES).some((aliases) =>
      aliases.includes(normalizedValue),
    );
  });

  return recognizedHeaders.length >= 2;
}

function getPositionalIndexes(columnCount) {
  if (columnCount === 2) {
    return {
      name: 0,
      set_code: -1,
      collector_number: -1,
      quantity: 1,
      finish: -1,
    };
  }

  if (columnCount === 3) {
    return {
      name: 0,
      set_code: 1,
      collector_number: -1,
      quantity: 2,
      finish: -1,
    };
  }

  return {
    name: 0,
    set_code: 1,
    collector_number: 2,
    quantity: 3,
    finish: columnCount >= 5 ? 4 : -1,
  };
}

function normalizeFinish(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (["true", "yes", "1", "foil"].includes(normalized)) return "foil";
  if (["false", "no", "0", "nonfoil", "non-foil"].includes(normalized)) {
    return "nonfoil";
  }
  if (normalized === "etched") return "etched";
  return normalized || "nonfoil";
}

export function parseCollectionCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return { rows: [], errors: [{ row_number: 1, error: "CSV is empty." }] };
  }

  const firstRow = parseCsvLine(lines[0]);
  const hasHeaderRow = looksLikeHeaderRow(firstRow);
  const indexes = hasHeaderRow
    ? Object.fromEntries(
        Object.keys(HEADER_ALIASES).map((field) => [
          field,
          findHeaderIndex(firstRow, field),
        ]),
      )
    : getPositionalIndexes(firstRow.length);
  const errors = [];

  if (hasHeaderRow && (indexes.name === -1 || indexes.quantity === -1)) {
    errors.push({ row_number: 1, error: "CSV must include Name and Quantity columns." });
  }

  if (!hasHeaderRow && firstRow.length < 2) {
    errors.push({
      row_number: 1,
      error: "Headerless CSV rows must include at least Name and Quantity.",
    });
  }

  const dataLines = hasHeaderRow ? lines.slice(1) : lines;

  if (dataLines.length > COLLECTION_CSV_MAX_ROWS) {
    errors.push({
      row_number: 1,
      error: `CSV imports are limited to ${COLLECTION_CSV_MAX_ROWS.toLocaleString()} rows.`,
    });
  }

  if (errors.length > 0) return { rows: [], errors };

  const rows = dataLines.map((line, index) => {
    const values = parseCsvLine(line);
    const getValue = (field) => indexes[field] === -1 ? "" : values[indexes[field]] || "";

    return {
      row_number: index + (hasHeaderRow ? 2 : 1),
      name: getValue("name"),
      set_code: getValue("set_code"),
      collector_number: getValue("collector_number"),
      quantity: getValue("quantity"),
      finish: normalizeFinish(getValue("finish")),
    };
  });

  return { rows, errors: [] };
}

export function downloadCollectionErrors(errors, filename = "collection-errors.csv") {
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [
    "row_number,card_name,quantity,error",
    ...errors.map((error) =>
      [error.row_number || "Import", error.name, error.quantity, error.error]
        .map(escape)
        .join(","),
    ),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
