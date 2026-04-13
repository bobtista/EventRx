const API_URL = "https://api.fda.gov/transparency/crl.json";
const BUCKET_BASE = "https://download.open.fda.gov/crl";
const PAGE_SIZE = 100;

async function sha256(text) {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isValidCrlRecord(raw) {
  const fileName = raw.file_name || "";
  return typeof fileName === "string" && fileName.startsWith("CRL_");
}

function normalizeApplicationNumber(raw) {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((x) => String(x).trim()).filter(Boolean).join(", ");
  }
  if (typeof raw === "string") return raw.trim();
  return "";
}

async function normalizeRecord(raw) {
  const fileName = raw.file_name;
  const text = raw.text || "";
  return {
    event_id: await sha256(fileName),
    file_name: fileName,
    application_number: normalizeApplicationNumber(raw.application_number),
    company_name: (raw.company_name || "").trim(),
    letter_date: (raw.letter_date || "").trim(),
    letter_type: (raw.letter_type || "").trim(),
    text: text,
    text_hash: await sha256(text),
    pdf_url: `${BUCKET_BASE}/${fileName}`,
  };
}

export async function fetchRecent() {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    sort: "letter_date:desc",
  });
  const resp = await fetch(`${API_URL}?${params}`);
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`openFDA HTTP ${resp.status}`);
  const data = await resp.json();
  const rawResults = data.results || [];

  const records = [];
  for (const raw of rawResults) {
    if (!isValidCrlRecord(raw)) continue;
    records.push(await normalizeRecord(raw));
  }
  return records;
}

export async function fetchAllPaginated(onPage) {
  let skip = 0;
  let total = 0;

  while (true) {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      skip: String(skip),
      sort: "letter_date:desc",
    });
    const resp = await fetch(`${API_URL}?${params}`);
    if (resp.status === 404) break;
    if (!resp.ok) throw new Error(`openFDA HTTP ${resp.status}`);
    const data = await resp.json();
    const rawResults = data.results || [];
    if (rawResults.length === 0) break;

    const page = [];
    for (const raw of rawResults) {
      if (!isValidCrlRecord(raw)) continue;
      page.push(await normalizeRecord(raw));
    }

    if (onPage) onPage(page);
    total += page.length;

    if (rawResults.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    if (skip >= 25000) break;
  }

  return total;
}
