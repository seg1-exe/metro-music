import pandas as pd
import os
import ast

# Configuration
DATA_DIR = './data'

def load_data():
    print("Loading data... (this may take a few seconds)")

    # 1. Load genres
    # genres.csv is straightforward: index_col=0 uses the genre ID as the index
    genres = pd.read_csv(os.path.join(DATA_DIR, 'genres.csv'), index_col=0)

    # 2. Load tracks
    # tracks.csv has 3 header rows; the index is column 0 (track_id)
    tracks = pd.read_csv(os.path.join(DATA_DIR, 'tracks.csv'), index_col=0, header=[0, 1, 2])

    return genres, tracks

def analyze_metro_topology(genres, tracks):
    print("\n--- METRO TOPOLOGY ANALYSIS ---")

    # STEP A: Identify lines (root genres)
    # In FMA, a root genre has parent_id = 0
    root_genres = genres[genres['parent'] == 0]

    print(f"Lines detected (root genres): {len(root_genres)}")

    # STEP B: Count tracks per line
    # tracks['track']['genre_top'] holds the root genre name
    track_counts = tracks['track']['genre_top'].value_counts()

    metro_lines = []

    for genre_id, row in root_genres.iterrows():
        genre_name = row['title']
        count = track_counts.get(genre_name, 0)
        sub_stations_count = len(genres[genres['parent'] == genre_id])

        metro_lines.append({
            "id": genre_id,
            "name": genre_name,
            "tracks_available": count,
            "sub_stations_direct": sub_stations_count
        })

    # Sort by popularity (track count)
    metro_lines.sort(key=lambda x: x['tracks_available'], reverse=True)

    print(f"\n{'ID':<5} | {'LINE NAME (GENRE)':<20} | {'TRACKS':<10} | {'SUB-STATIONS'}")
    print("-" * 60)
    for line in metro_lines:
        print(f"{line['id']:<5} | {line['name']:<20} | {line['tracks_available']:<10} | {line['sub_stations_direct']}")

    return metro_lines

if __name__ == "__main__":
    try:
        if not os.path.exists(os.path.join(DATA_DIR, 'tracks.csv')):
            print(f"ERROR: Files not found in {DATA_DIR}. Check the path.")
        else:
            genres_df, tracks_df = load_data()
            lines = analyze_metro_topology(genres_df, tracks_df)
            print("\nSUCCESS: Data loaded. Ready for JSON export.")

    except Exception as e:
        print(f"An error occurred: {e}")
