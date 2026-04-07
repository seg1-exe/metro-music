import os
import json
import random

# --- CONFIGURATION ---
INPUT_JSON = 'metro_data_enriched.json'  # Input file with track metadata
OUTPUT_JSON = 'metro_data_local.json'    # Final file for the website
MUSIC_DIR = 'music'

def link_files():
    print("--- LINKING LOCAL AUDIO FILES ---")

    # 1. Scan the music directory
    if not os.path.exists(MUSIC_DIR):
        print(f"Error: directory '{MUSIC_DIR}' not found.")
        return

    available_files = [f for f in os.listdir(MUSIC_DIR) if f.endswith('.mp3')]

    if not available_files:
        print(f"Error: no MP3 files found in '{MUSIC_DIR}'.")
        return

    print(f"{len(available_files)} files found.")

    # Extract IDs (without .mp3 extension) for fast lookup
    available_ids = set([f.split('.')[0] for f in available_files])

    # 2. Load JSON
    try:
        with open(INPUT_JSON, 'r', encoding='utf-8') as f:
            metro_data = json.load(f)
    except FileNotFoundError:
        print(f"Error: {INPUT_JSON} not found. Run the enrichment script first.")
        return

    count_real = 0
    count_fallback = 0

    # 3. Update URLs
    for station in metro_data['stations']:
        if 'playlist' not in station:
            continue

        for track in station['playlist']:
            track_id = str(track['id'])

            if track_id in available_ids:
                track['url'] = f"{MUSIC_DIR}/{track_id}.mp3"
                track['is_real'] = True
                count_real += 1
            else:
                # File missing: assign a random available file as fallback
                random_backup = random.choice(available_files)
                track['url'] = f"{MUSIC_DIR}/{random_backup}"
                track['is_real'] = False
                count_fallback += 1

    # 4. Save
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(metro_data, f, indent=2)

    print("-" * 30)
    print(f"{count_real} real links created.")
    print(f"{count_fallback} fallback links created.")
    print(f"Output file: {OUTPUT_JSON}")

if __name__ == "__main__":
    link_files()
