# TRACKS — Musical Journey

An interactive visualization of music genres as a metro map. Select two stations (sub-genres) to embark on an automatic musical journey with crossfade between tracks.

## How it works

- Each **line** represents a music genre (Rock, Jazz, Electronic…)
- Each **station** represents a sub-genre
- **Transfer hubs** connect musically related sub-genres
- Choosing a start and a destination generates a route with automatic playback

## Demo

Open `index.html` in a browser (requires a local HTTP server, see below).

> Audio files come from the [Free Music Archive (FMA)](https://github.com/mdeff/fma) dataset — Small subset, under Creative Commons licenses. They are included in the repo (`music/`).

## Setup

### Requirements

- A modern browser
- A local HTTP server (Python works fine)

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/seg1-exe/metro-music.git
cd metro-music

# 2. Start a local HTTP server
python3 -m http.server 8000
# Then open http://localhost:8000
```

> **Note**: opening `index.html` directly via `file://` may block audio loading in some browsers. Use a local HTTP server instead.

The 561 MP3 files (~560 MB) are included in the repo under `music/`. They come from the [Free Music Archive (FMA)](https://github.com/mdeff/fma) dataset under Creative Commons licenses.

## Project structure

```
metro-music/
├── index.html              — Main interface
├── sketch.js               — p5.js logic (visualization + audio)
├── metro_data_local.json   — Metro data (generated)
├── music/                  — MP3 files (561 files, ~560 MB)
├── export_metro.py         — Generates metro_data.json from FMA CSVs
├── link_local_files.py     — Maps local audio URLs to the JSON
├── main.py                 — FMA dataset topology analysis
└── requirements.txt        — Python dependencies
```

## Tech stack

- **Frontend**: Vanilla HTML/CSS/JS + [p5.js](https://p5js.org/) for the canvas
- **Data**: Python + pandas for JSON generation
- **Audio**: Web Audio API (crossfade between tracks)

## License

MIT — see [LICENSE](LICENSE).

Music tracks are under their respective Creative Commons licenses (FMA dataset).
