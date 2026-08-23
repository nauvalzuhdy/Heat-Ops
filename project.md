# HeatOps — Master Build Doc (v2)

**FortyGuard Hackathon'26** · Event: 18–30 Aug 2026 · Submission deadline: **30 Aug 2026, 11:59 PM GST**
**Status: P0 LUNAS ✅ (6/6, Map View complete) | P1 sedang berlangsung (Sub-task 1 done, Sub-task 2-9 + 3 features parallel)**
Progress detail: lihat PROGRESS_SUMMARY.md

---

## 0. Kenapa sebelumnya berantakan (baca sekali, lalu lupakan)

Tiga pola yang bikin development terasa "meleset dari rencana":
1. **Brief asli lengkap, tapi 2 fitur besar (Route/logistics, forecast) baru muncul lagi sekarang** — bukan salah eksekusi, itu memang belum pernah ditulis di spec manapun sebelumnya
2. **Keputusan teknis (satellite scope, MaskExtension gagal, granularity adaptif) dibuat 1-per-1 lewat chat** — tiap keputusan benar sendiri-sendiri, tapi agent yang baru mulai sesi tidak otomatis tahu semua itu kecuali dikasih tahu ulang
3. **Beberapa instruksi dikirim sebagai gabungan besar (4 masalah sekaligus)** — makin banyak perubahan serentak, makin susah tahu perubahan mana yang menyebabkan bug baru

Fix-nya bukan "kerja lebih hati-hati" — fix-nya **struktur**: 1 dokumen lengkap (file ini), 1 fitur dikerjakan tuntas+terverifikasi sebelum lanjut (§9), dan format prompt yang konsisten (§10). Itu isi seluruh file di bawah ini.

---

## 1. Visi produk (ringkas)

HeatOps: platform 3-fase berbasis data suhu udara 2-meter FortyGuard + Operations Research + spatial analysis + Agentic AI, untuk membantu industri memilih & mengelola site secara sadar-panas.

**3 halaman yang dibangun** (urutan build = urutan prioritas):

| # | Halaman | Peran |
|---|---|---|
| 1 | **Map View** | Akuisisi data — cari lokasi, gambar AOI, ambil data heat+land-cover+forecast+route dari FortyGuard/Overpass/routing engine, render 3D, simpan sebagai site record |
| 2 | **Operational Analyst** | Analisis & keputusan — konsumsi site record tersimpan, deteksi hotspot, rekomendasi intervensi (canopy/solar/gedung baru), shift schedule ISO 7243/NIOSH, analisis foto+keputusan, grafik/chart, download PDF report |
| 3 | **AI Copilot** | Chat lintas-halaman — tanya apa saja soal data yang sudah dikumpulkan, powered oleh **DeepSeek API** |

---

## 2. Constraint kritis (wajib dipatuhi semua kode, semua fitur)

| Constraint | Detail |
|---|---|
| **Coverage FortyGuard: US-only** | AOI demo harus di kota AS (Phoenix/Houston/Miami/New York/San Jose). Search default fly ke kota itu. |
| **Date range** | `2021-01-01` → sekarang. Heatmap forecast maksimal **+12 jam** ke depan — ini basis fitur forecast di §4.4. |
| **Area limit** | `/v1/heatmap` dibatasi **~130 km² (50 mi²)**. Validasi `turf.area()` sebelum submit. |
| **Auth** | Header `api-key`, base URL `https://api.fortyguard.com`. Key server-only, jangan pernah expose ke client/commit ke repo. |
| **Async pattern** | POST → `response.data.activity_id` (nested, terverifikasi dari kode resmi) → poll `GET /v1/status/{activity_id}` dengan backoff 3s→6s→12s. Gagal = gratis. |
| **`/v1/satellite` scope terbatas** | Point + fixed radius di sekitar centroid, **BUKAN** representatif seluruh AOI (terbukti: AOI 93,5 km² → Building 97.4%, jelas cuma spot-sample). **Disembunyikan dari Map View**, dipakai lagi di Operational Analyst sebagai referensi titik saja. |
| **Overpass bisa timeout (504)** di AOI besar | Wajib retry+backoff+mirror fallback (§7). |
| **Plan: Premium** ✅ | Semua endpoint FortyGuard termasuk `/v1/satellite`, `/v1/streetview`, `/v1/heat_intelligence` tersedia. |
| **1 fitur, 1 prompt, 1 verifikasi** | Lihat §10 — jangan kirim gabungan banyak perubahan sekaligus kecuali sudah lolos tahap sebelumnya. |

---

## 3. Tech stack final

| Layer | Pilihan |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind |
| Map | MapLibre GL JS + Esri World Imagery (raster satelit, `maxzoom` disesuaikan per lokasi) |
| 3D & heat visual | deck.gl (`GeoJsonLayer` extruded, `LightingEffect`+`_shadow`), **heatmap sebagai gambar canvas 2D** (bukan live WebGL layer — `MaskExtension` terbukti tidak reliable untuk kasus ini) |
| Draw tool | terra-draw (`TerraDrawPolygonMode` aktif; freehand/rect/circle backlog polish) |
| Routing (fitur baru, §4.5) | OSRM public demo server (`router.project-osrm.org`) + scoring manual berbasis heat tile |
| Geospatial calc | Turf.js |
| State | Zustand (AOI/session), React Query (polling) |
| Data & storage | Supabase (Postgres `sites` + `routes` table, Storage untuk foto/report) |
| Charts | Recharts |
| PDF report | WeasyPrint (server) atau `@react-pdf/renderer` |
| **AI Copilot** | **DeepSeek API** (`deepseek-chat` / `deepseek-reasoner`, OpenAI-compatible endpoint `https://api.deepseek.com/v1`, function calling didukung — arsitektur tool-use sama seperti sebelumnya, cuma ganti provider) |
| Deploy | Vercel |

---

## 4. Map View — spec fitur lengkap

### 4.1 Search & Draw AOI
Search (Nominatim) → fly ke lokasi. Draw AOI (terra-draw polygon). Validasi: ring tertutup, no self-intersect (`@turf/kinks`), luas < 130 km².

### 4.2 Land-cover breakdown
**Overpass = satu-satunya sumber %-breakdown yang tampil di UI**, clip exact ke AOI. **5 kategori** (bukan 3): Building, Road, Vegetation (grass/forest/wood, exclude `natural=tree` karena node tanpa luas), Water (dipisah dari Other), Other (ground/sisanya).

**Warna — 1 sumber kebenaran tunggal, wajib dipakai konsisten di bar chart DAN map, tidak boleh ada hardcode terpisah:**
```ts
// lib/landcoverColors.ts
export const LANDCOVER_COLORS = {
  building:   '#3B82F6', // biru
  road:       '#EAB308', // kuning
  vegetation: '#22C55E', // hijau
  water:      '#06B6D4', // cyan/teal -- sengaja beda jelas dari biru building
  other:      '#6B7280', // abu-abu
};
```
Semua komponen yang menampilkan warna land-cover (bar chart di panel, `LandcoverLayer` di map, legend, dll) **wajib** import dari file ini. Ini pelajaran dari bug nyata: warna sempat didefinisikan 2x di 2 tempat (bar chart vs map layer) dan drift jadi tidak konsisten.

**Tag Overpass untuk water:** `natural=water`, `waterway=*` (sungai/kanal), `landuse=reservoir`.

`/v1/satellite` tetap di-fetch untuk disimpan, **tidak ditampilkan** di halaman ini.

### 4.3 Heatmap
`/v1/heatmap` dengan `polygon_aoi` penuh, `granularity` **adaptif** terhadap luas AOI (target 50-300 tile, bukan konstanta 60). Hasil ditampilkan sebagai **gambar canvas 2D** (di-`clip()` presisi ke bentuk AOI) di kartu "Surface heatmap" — bukan layer live di map.

### 4.4 Forecast +12 jam (FITUR BARU, dari brief asli yang sempat hilang)
Setelah AOI dipilih, tambahkan **time selector** di atas tombol Analyze: `Now / +3h / +6h / +9h / +12h` (dibatasi hard oleh constraint FortyGuard di §2). Tiap pilihan trigger ulang `/v1/heatmap` dengan `start_time` yang disesuaikan (`filter_type: 1`, jam spesifik) — bukan `filter_type: 3` (yang dipakai untuk analisis 1 hari penuh di §4.3). Tampilkan sebagai **mini time-series** di bawah kartu heatmap: Mean temp per slot waktu, biar user lihat tren naik/turun dalam 12 jam ke depan, bukan cuma 1 snapshot.
**Definition of done:** ganti slot waktu → gambar heatmap regenerate → angka Mean berubah sesuai slot, tidak stuck di 1 nilai.

### 4.5 Route button — logistics heat-aware routing (FITUR BARU, dari brief asli)
Di sebelah tombol draw AOI, tambahkan tombol **"Route"**. Alur: user klik titik asal → titik tujuan (seperti Google Maps) → sistem:
1. Fetch 2-3 alternatif rute dari OSRM publik (`router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}?alternatives=true&geometries=geojson`)
2. Untuk tiap rute, ambil bbox rute → submit `/v1/heatmap` untuk area itu (atau reuse tile yang sudah ada kalau overlap dengan AOI yang sudah dianalisis)
3. Sample suhu di sepanjang garis rute (titik tiap ~200m, ambil tile heatmap terdekat)
4. Hitung **skor exposure** per rute (rata-rata + maks suhu yang dilewati)
5. Highlight rute dengan skor terendah sebagai **"Recommended (coolest)"**, tampilkan juga rute tercepat sebagai pembanding — biarkan user pilih

> Ini **cocok sekali** dengan Track 1 (Resilient Cities & Infrastructure) di handbook FortyGuard — disebutkan eksplisit sebagai contoh proyek ("cool-route planner... rank... lowest-heat-exposure walking path"). Kalau waktu terbatas, ini boleh jadi **stretch P1**, bukan blocker P0 — Map View inti (search/draw/heatmap/land-cover/3D) harus selesai duluan.

**Definition of done:** pilih titik A-B → minimal 1 rute alternatif muncul dengan skor exposure berbeda → rute "coolest" ter-highlight beda warna dari rute tercepat.

### 4.6 3D rendering
`BuildingLayer` (Overpass extrusion) dengan `LightingEffect`+`_shadow`. 2 mode toggle: **Massing view** (netral, untuk kesan kota 3D ala referensi) vs **Land-cover view** (recolor biru/kuning). Auto-fit kamera `pitch: 60` ke bounds AOI.

### 4.7 3 foto output + simpan site record
Foto satelit asli (ArcGIS Export Image), foto segmentasi (canvas dari geometri Overpass), foto heat (dari §4.3). Simpan 1 row ke Supabase `sites` (skema di §8) + upload foto ke Storage. Tombol **"Analyze this site"** → `/analyst?siteId=xxx`.

---

## 5. Operational Analyst — spec fitur lengkap (REVISI: dashboard vs chat)

Menerima `siteId`, **tidak** panggil FortyGuard lagi — semua dari data tersimpan.

**Prinsip pembagian (penting, hasil diskusi ulang):** ada 2 jenis kebutuhan yang beda sifatnya, jangan disamakan:
- **Visualisasi data (selalu tampil, tidak butuh pertanyaan)** → dashboard §5 di halaman ini, dibangun sebagai UI tetap
- **Jawaban atas pertanyaan spesifik/skenario ("solar atau canopy?", "bisa tambah gedung?", "analisis foto ini")** → **BUKAN** dibangun sebagai halaman/tombol terpisah per pertanyaan. Compute logic-nya tetap dibangun sebagai *backend function*, tapi di-expose lewat **AI Copilot (§6) sebagai tools**, bukan UI dashboard permanen. Alasan: kalau tiap kemungkinan pertanyaan stakeholder dapat 1 tombol/halaman sendiri, UI membengkak tak terbatas dan membingungkan. Chat interface bisa jawab pertanyaan apa pun (termasuk yang belum kepikiran sekarang) selama tools-nya tersedia — jauh lebih scalable dan sesuai alur yang diinginkan: data → compute → tanya AI → report.

| Fitur | Tempat | Detail |
|---|---|---|
| **Hotspot detection** | Dashboard (selalu tampil) | Bin `heat_tiles` ke grid zona (3×3), rata-rata suhu per zona, urutkan, tandai tertinggi. Ini data dasar yang dibutuhkan hampir semua fitur lain, termasuk sebagai tool AI Copilot |
| **Shift schedule** | Dashboard (selalu tampil) | Bandingkan suhu per-jam (forecast §4.4) terhadap ambang ISO 7243/NIOSH → rekomendasi jam kerja aman vs berbahaya |
| **Rekomendasi intervensi (headline, 1 kartu default)** | Dashboard (selalu tampil, deterministic, TIDAK bergantung LLM — demo harus reliable) | Heuristik defisit canopy vs target land-cover → 1 rekomendasi utama ditampilkan otomatis tanpa perlu tanya. Badge **"Simulated"** |
| **ROI Simulator (§5.1)** | Dashboard (selalu tampil, interaktif form) | Tetap UI form — ini bukan "pertanyaan", ini alat kalkulasi yang user pakai berulang dengan angka mereka sendiri |
| **Grafik/chart (Recharts)** | Dashboard (selalu tampil) | (a) Bar chart suhu per zona, (b) Pie chart land-cover, (c) Time-series 12 jam, (d) ringkasan KPI. Ini **wajib UI**, tidak bisa digantikan chat — dibutuhkan juga untuk PDF report |
| **Download PDF report** | Dashboard (tombol) | Compile chart + rekomendasi headline + **ringkasan naratif dari AI Copilot** (lihat §6) jadi 1 PDF |
| ~~Evaluasi gedung baru~~ | **PINDAH ke §6 (AI Copilot, tool `check_new_building_feasibility`)** | User tanya "bisa nggak tambah gedung di zona timur?", AI panggil tool ini, jawab dalam chat |
| ~~Solar vs canopy comparison~~ | **PINDAH ke §6 (tool `compare_interventions`)** | User tanya "solar atau canopy lebih baik untuk budget $50rb?", AI panggil tool ROI dengan 2 skenario, bandingkan dalam jawaban chat |
| ~~Analisis foto + tombol keputusan~~ | **PINDAH ke §6 (chat dengan image upload, DeepSeek vision)** | User upload foto langsung di chat, tanya "kondisi ini gimana?", AI jawab dengan vision — tidak perlu halaman terpisah dengan tombol pra-set |

### 5.1 ROI Simulator — detail formula & Definition of Done

**Input form (semua editable oleh user, dengan default value yang masuk akal):**
- Budget tersedia (USD) — opsional, dipakai untuk batasi skenario "apa yang terjangkau"
- Biaya per pohon (USD/pohon) — default contoh: $150-300
- Biaya per m² kanopi buatan/shading structure (USD/m²)
- Biaya per kW panel surya terpasang (USD/kW)
- Tarif listrik lokal (USD/kWh) — default bisa diambil dari EIA (Track 4/5 handbook sebut EPA/USDA sebagai sumber acuan federal, cari tarif listrik industri per-state kalau ada waktu, kalau tidak biarkan user isi manual)
- Horizon simulasi (dropdown: 5/10/20 tahun)

**Formula (extend dari `calculateImpact()` yang sudah ada di rencana, sekarang parameterized):**
```ts
function simulateROI(inputs: ROIInputs, hotspot: HotspotZone, coolingC: number) {
  const totalCost =
    inputs.numTrees * inputs.costPerTree +
    inputs.canopyM2 * inputs.costPerCanopyM2 +
    inputs.solarKW * inputs.costPerSolarKW;

  const estimatedKwhSavedPerYear = coolingC * hotspot.areaM2 * ASSUMPTION_KWH_PER_M2_PER_DEGREE; // konstanta asumsi, tampilkan sumbernya di UI
  const annualSavingsUSD = estimatedKwhSavedPerYear * inputs.electricityRateUSD;

  const paybackYears = totalCost / annualSavingsUSD;
  const cumulativeCostByYear = Array.from({length: inputs.horizonYears}, (_, y) => totalCost); // flat, one-time cost
  const cumulativeSavingsByYear = Array.from({length: inputs.horizonYears}, (_, y) => annualSavingsUSD * (y + 1));

  return { totalCost, annualSavingsUSD, paybackYears, cumulativeCostByYear, cumulativeSavingsByYear };
}
```
⚠️ `ASSUMPTION_KWH_PER_M2_PER_DEGREE` itu **wajib dicari basisnya** (referensi studi UHI/cooling load standar, atau minimal disclose sebagai asumsi kasar) sebelum dipakai di demo — jangan biarkan angka ajaib tanpa sumber, karena ini akan langsung ditanya kalau ada judge dari Track 3 yang paham underwriting/finance.

**Render:** chart breakeven (garis kumulatif cost vs kumulatif savings, deck.gl/Recharts `LineChart`), titik potong = payback year, ditandai jelas. Update live tiap kali input form berubah (`onChange`, bukan perlu submit button).

**Definition of done:**
- [ ] Ubah salah satu input (misal biaya per pohon) → payback year & chart langsung berubah tanpa reload
- [ ] Payback year yang tidak masuk akal (misal negatif, atau savings = 0 menyebabkan division by zero/Infinity) ditangani dengan pesan jelas ("Investasi ini tidak akan balik modal dengan asumsi saat ini"), bukan crash/NaN
- [ ] Badge "Simulated — based on your inputs" tampil jelas, beda visual dari badge "Real"/"Simulated" heuristik sistem lainnya
- [ ] Sumber `ASSUMPTION_KWH_PER_M2_PER_DEGREE` (atau disclosure bahwa ini asumsi kasar) tertulis di tooltip/footnote

---

## 6. AI Copilot — DeepSeek

- **Provider:** DeepSeek API, endpoint `https://api.deepseek.com/v1` (OpenAI-compatible SDK, tinggal ganti `baseURL` + `apiKey` kalau pakai library `openai`)
- **Model:** `deepseek-chat` untuk chat umum, `deepseek-reasoner` kalau butuh reasoning lebih dalam (mis. menjelaskan kenapa suatu zona direkomendasikan). Cek dukungan vision di dokumentasi terbaru DeepSeek untuk fitur foto (`analyze_field_photo`) — kalau belum ada, fallback ke deskripsi teks manual dari user + analisis text-only
- **Tool-use — daftar lengkap (hasil pemindahan dari §5, ini "otak" produk sekarang, bukan cuma pelengkap):**

| Tool | Fungsi | Menggantikan fitur lama |
|---|---|---|
| `get_site_data(siteId)` | Ambil semua data mentah 1 site | - |
| `get_hotspot(siteId)` | Zona mana yang paling panas | ditampilkan juga di dashboard §5 |
| `recommend_intervention(siteId, targetZone?)` | Rekomendasi canopy/pohon untuk 1 zona | headline card di dashboard §5 |
| `simulate_roi(siteId, interventionType, costInputs)` | Hitung ROI untuk 1 skenario intervensi spesifik | dipakai user via chat, bukan cuma form §5.1 |
| `compare_interventions(siteId, optionA, optionB)` | Panggil `simulate_roi` 2x, bandingkan hasilnya | **eks Sub-task 5 (solar vs canopy)** |
| `check_new_building_feasibility(siteId, zone?)` | Cek zona bersuhu rendah + land-cover kosong sebagai kandidat lokasi gedung baru | **eks Sub-task 6 (evaluasi gedung baru)** |
| `analyze_field_photo(imageData, siteId?)` | Vision analysis foto lapangan yang di-upload user di chat | **eks Sub-task 7 (analisis foto)** |
| `generate_report(siteId)` | Compile ringkasan naratif untuk PDF | dipanggil dari tombol "Download PDF" di §5 |

- **Scope:** bisa ditanya lintas halaman (Map View + Operational Analyst), tapi **hanya berdasarkan data yang sudah tersimpan** — sama seperti Operational Analyst, tidak panggil FortyGuard baru dari sini
- **UI chat:** support image upload (untuk `analyze_field_photo`), riwayat chat per-siteId (opsional, tersimpan atau tidak tergantung waktu)
- Cek dokumentasi resmi DeepSeek untuk rate limit & pricing terbaru sebelum implementasi — jangan asumsikan sama dengan OpenAI

---

## 7. Kontrak API (fakta terverifikasi, jangan ditebak ulang)

### `POST /v1/heatmap`
```python
payload = {
  "polygon_aoi": { "type": "Polygon", "coordinates": [[...]] },  # tutup ring
  "date_time": { "start_date": "2026-08-20", "start_time": "14:00", "filter_type": 3 },
  "granularity": 100  # ADAPTIF, lihat pickGranularity() di bawah
}
response = requests.post(url, headers=headers, json=payload)
activity_id = response.json()["data"]["activity_id"]  # NESTED
```
`filter_type`: 1=jam spesifik (dipakai untuk forecast §4.4), 2=range jam, 3=1 hari penuh (dipakai untuk analisis utama §4.3), 4=range hari, 5=1 bulan.

```ts
function pickGranularity(areaM2: number): 60 | 80 | 100 {
  const targetTiles = 150;
  const idealCellSize = Math.sqrt(areaM2 / targetTiles);
  if (idealCellSize <= 70) return 60;
  if (idealCellSize <= 90) return 80;
  return 100;
}
```

### `/v1/satellite`
Point + fixed radius dari centroid. **Tidak representatif AOI**. Fetch & simpan saja, jangan tampilkan di Map View (§4.2). Dipakai lagi di Operational Analyst sebagai referensi titik.

### Overpass API (OSM) — sumber utama land-cover
Wajib retry+backoff+mirror:
```
Percobaan 1: overpass-api.de, timeout 25s
Gagal → percobaan 2 (backoff 2s): overpass.kumi.systems
Gagal → percobaan 3 (backoff 5s): overpass.openstreetmap.ru
Semua gagal → tampilkan pesan jelas ke user, bukan raw XML error
```

### OSRM (routing, §4.5)
```
GET https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}?alternatives=true&geometries=geojson
```
Publik, tanpa key, tapi rate-limited — jangan spam saat development, cache hasil per pasangan titik.

### Proxy internal (Next.js)
```
POST /api/heat/submit          -> /v1/heatmap
POST /api/landcover/submit     -> /v1/satellite (disimpan, tidak ditampilkan)
POST /api/route/plan           -> OSRM + scoring heat exposure
GET  /api/status/:jobId        -> /v1/status/{activity_id}
```
Semua cache di Supabase (`heat_cache`, `landcover_cache`, `route_cache`) keyed by hash input, supaya tidak submit ulang & buang credit.

---

## 8. Data handoff — skema Supabase

```sql
create table sites (
  id uuid primary key default gen_random_uuid(),
  name text,
  aoi_geometry jsonb not null,
  site_area_m2 numeric,
  landcover jsonb,               -- dari Overpass, sumber utama
  landcover_spotcheck jsonb,     -- dari /v1/satellite, disimpan tapi tidak tampil di Map View
  heat_tiles jsonb,
  heat_forecast jsonb,           -- array { hourOffset, meanTempC, capturedAt } dari §4.4
  heat_stats jsonb,
  satellite_photo_url text,
  segmentation_photo_url text,
  heat_photo_url text,
  attribution jsonb,
  created_at timestamptz default now()
);

create table routes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id),
  origin jsonb, destination jsonb,
  alternatives jsonb,             -- array { geometry, distanceM, durationS, heatExposureScore }
  recommended_route_index int,
  created_at timestamptz default now()
);
```

Map View **menulis** ke `sites`/`routes`. Operational Analyst **membaca** by `siteId`, tidak panggil API eksternal lagi.

---

## 9. Roadmap P0 → P3

### P0 — 3D feature + data real + semua API jalan
- [x] §4.1 Search + Draw AOI
- [x] §4.2 Land-cover (Overpass utama 5 kategori incl. Vegetation tag diperluas & Water, satellite disembunyikan dari UI tapi tetap fetch+simpan, retry+mirror untuk 504 ✅, warna tunggal `lib/landcoverColors.ts` ✅)
- [x] §4.3 Heatmap (granularity adaptif ✅, render gambar canvas gradasi halus ter-clip ✅)
- [x] §4.6 3D rendering (lighting + 2 mode visual ✅)
- [x] §4.7 3 foto output + simpan site record ke Supabase ✅ (terverifikasi: row lengkap, `landcover_spotcheck` terisi via `FORTYGUARD_MODE=live`, 3 foto valid, 2 AOI → 2 row terpisah)
- [x] Tombol "Analyze this site" → siteId valid tervalidasi

**P0 LUNAS 6/6.** ✅

### P1 — dashboard analisis + grafik + report (sedang berlangsung)
> **Revisi scope:** Sub-task 5/6/7 versi lama (halaman/tombol terpisah) DIHAPUS dari P1, pindah jadi tools AI Copilot di P2 (lihat §5 dan §6). P1 sekarang fokus ke yang benar-benar butuh UI tetap: hotspot, shift, 1 kartu rekomendasi headline, ROI form, charts, PDF.

- [x] Sub-task 1: Halaman `/analyst` dasar + card grid layout ✅
- [ ] Sub-task 2: Hotspot detection (zone binning, zona tertinggi) — **akan dimulai**
- [ ] Sub-task 3: Shift schedule ISO 7243/NIOSH
- [ ] Sub-task 4: Rekomendasi intervensi headline (1 kartu, deterministic) + **ROI Simulator (§5.1)**
- [ ] Sub-task 5 (dulu "8"): Charts lengkap (Recharts: bar suhu/zona, pie land-cover, time-series forecast, KPI ringkas)
- [ ] Sub-task 6 (dulu "9"): PDF report download (chart + rekomendasi headline + ringkasan naratif dari AI Copilot §6)

**Parallel features (saat P1):**
- [ ] §4.4: Forecast +12 jam di Map View (time selector, array heat_forecast ke Supabase) — opsional, bisa skip kalau ketat
- [ ] Feature A: Site naming saat save di Map View (modal input, auto-generate kalau kosong) — **dimulai parallel**
- [ ] Feature B: Edit/Delete sites di /analyst list (edit nama, konfirmasi delete) — **dimulai parallel**

### P2 — AI Copilot: "otak" produk, bukan cuma pelengkap (belum dimulai)
- [ ] §6 setup dasar: chat UI + DeepSeek API connection + `get_site_data` tool
- [ ] Tool `get_hotspot` + `recommend_intervention` (reuse compute dari P1 Sub-task 2/4)
- [ ] Tool `simulate_roi` + `compare_interventions` **(eks Sub-task 5 lama — solar vs canopy)**
- [ ] Tool `check_new_building_feasibility` **(eks Sub-task 6 lama — evaluasi gedung baru)**
- [ ] Tool `analyze_field_photo` + image upload di chat **(eks Sub-task 7 lama — analisis foto)**
- [ ] Tool `generate_report` untuk isi PDF §5

### P3 — testing & launch (belum dimulai)
- [ ] Full run-through end-to-end: Map View → Analyst → Copilot → PDF
- [ ] Cek semua badge attribution konsisten (Real/Simulated/Cached jelas)
- [ ] Rekam demo video (≤3 menit, Clueso), tulis script gaya YC
- [ ] Siapkan ringkasan submission (≤500 kata: problem → user → FortyGuard usage → hasil terukur)
- [ ] Repo public / invite `hackathon@fortyguard.com`, `.env` git-ignored
- [ ] Deploy Vercel, test live
- [ ] **Submit sebelum 30 Agustus 11:59 PM GST**

**Timeline kamu (Agustus 2026):** 20-21 riset (selesai, ini dokumennya) → 22-23 build inti P0-P1 → 24 cek kualitas demo → 25 generate video → 26 pastikan semua oke → 27→29 buffer & submit.

---

## 10. Sistem Prompt — supaya development terstruktur, bukan acak

**Aturan emas: 1 fitur/masalah per prompt, tunggu konfirmasi selesai+terverifikasi, baru lanjut.** Jangan gabung banyak perubahan tak terkait dalam 1 prompt kecuali sudah dalam bentuk checklist eksplisit yang kamu tulis sadar (seperti §9 di atas).

### Template A — Kickoff fitur baru
```
Konteks: baca docs/PROJECT.md, khususnya §[nomor section terkait].

Kerjakan [nama fitur, 1 fitur saja] sesuai spec di §[X].

Definition of done (harus lolos semua sebelum saya anggap selesai):
[copy-paste "Definition of done" dari section terkait, atau tulis sendiri
kalau section itu belum punya]

Jangan mengerjakan fitur lain di luar ini meski terlihat terkait. Kalau
kamu butuh informasi yang belum ada di PROJECT.md (nama field API, dll),
TANYAKAN saya dulu -- jangan menebak.
```

### Template B — Laporan bug
```
Bug ditemukan di [nama fitur]. Ekspektasi: [apa yang seharusnya terjadi].
Realita: [apa yang benar-benar terjadi, sertakan screenshot/angka kalau ada].

Sebelum memperbaiki, investigasi dulu dan laporkan ke saya kemungkinan akar
masalahnya (jangan langsung ubah kode). Setelah saya konfirmasi diagnosisnya,
baru perbaiki.
```

### Template C — Verifikasi selesai
```
Sebelum lanjut ke fitur berikutnya, tunjukkan ke saya:
1. [metric/angka konkret yang membuktikan fitur ini benar, spesifik ke fitur itu]
2. [screenshot atau output log yang relevan]
Saya akan konfirmasi "lanjut" secara eksplisit sebelum kamu mulai fitur berikutnya.
```

### Kapan boleh melanggar "1 fitur per prompt"
Kalau kamu sendiri yang menulis rencana multi-langkah secara sadar (seperti §9 roadmap ini), dan tiap langkah punya definition-of-done sendiri yang jelas — itu boleh, karena scope-nya sudah dikunci di dokumen, bukan berkembang liar di tengah percakapan.

---

## 11. Non-goals (jangan dikerjakan sebelum P0-P1 tuntas)

- Freehand/rectangle/circle draw mode (polish, backlog)
- `/v1/streetview`, `/v1/heat_intelligence` — di luar scope 3 halaman ini
- Live WebGL heatmap layer (`MaskExtension`) — sudah diganti pendekatan gambar canvas, jangan dikembalikan kecuali ada alasan kuat
- Perbandingan antar-site di Operational Analyst — stretch kalau P0-P2 sudah tuntas & waktu masih ada