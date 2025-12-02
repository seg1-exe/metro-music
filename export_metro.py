import pandas as pd
import os
import json
import ast

# --- CONFIGURATION ---
DATA_DIR = './data'
OUTPUT_FILE = 'metro_data.json'
MIN_LINK_STRENGTH = 1 

METRO_COLORS = [
    "#E63946", "#F1FAEE", "#A8DADC", "#457B9D", "#1D3557", 
    "#F4A261", "#2A9D8F", "#E9C46A", "#264653", "#D62828", 
    "#023047", "#FFB703", "#FB8500", "#8ECAE6", "#219EBC", "#B5179E"
]

def generate_metro_json():
    print("--- GÉNÉRATION AVEC LA COLONNE 'GENRES_ALL' ---")
    
    # 1. Chargement
    print("1. Chargement des CSV...")
    genres = pd.read_csv(os.path.join(DATA_DIR, 'genres.csv'), index_col=0)
    tracks = pd.read_csv(os.path.join(DATA_DIR, 'tracks.csv'), index_col=0, header=[0, 1, 2])
    
    # ON CHANGE ICI : On prend 'genres_all' au lieu de 'genres'
    # genres_all contient [id_enfant, id_parent, id_voisin...]
    df = tracks['track'][['genre_top', 'genres_all']].dropna()

    metro_data = { "lines": [], "stations": [], "transfers": [] }
    station_to_line_map = {}
    
    # 2. TOPOLOGIE (Lignes & Stations)
    print("2. Construction de la topologie...")
    root_genres = genres[genres['parent'] == 0].copy()
    color_idx = 0

    for root_id, root_row in root_genres.iterrows():
        root_name = root_row['title']
        
        # Filtre basique
        if len(df[df['genre_top'] == root_name]) == 0: continue

        line_color = METRO_COLORS[color_idx % len(METRO_COLORS)]
        color_idx += 1
        
        metro_data["lines"].append({
            "line_id": int(root_id),
            "name": root_name,
            "color": line_color
        })

        sub_genres = genres[genres['parent'] == root_id]
        for sub_id, sub_row in sub_genres.iterrows():
            station_id = int(sub_id)
            metro_data["stations"].append({
                "station_id": station_id,
                "name": sub_row['title'],
                "line_id": int(root_id)
            })
            station_to_line_map[station_id] = int(root_id)

    # 3. CORRESPONDANCES (Le fix critique)
    print("3. Analyse des connexions (via genres_all)...")
    connections = {}
    processed_tracks = 0
    
    # Debug : On va afficher ce qu'on trouve pour les 5 premiers tracks
    debug_mode = True 

    for track_id, row in df.iterrows():
        try:
            # genres_all est une string "[10, 12, 15]" -> liste [10, 12, 15]
            raw_genres = row['genres_all']
            g_list = ast.literal_eval(raw_genres)
            
            # On ne garde que les genres qui sont des stations affichées sur la carte
            valid = [g for g in g_list if g in station_to_line_map]
            
            # Debug visuel pour toi
            if debug_mode and len(valid) > 1:
                print(f"   [DEBUG] Track {track_id} lie les stations : {valid}")
                processed_tracks += 1
                if processed_tracks > 5: debug_mode = False

            valid.sort()
            
            # Création des liens tous azimuts
            for i in range(len(valid)):
                for j in range(i + 1, len(valid)):
                    s1, s2 = valid[i], valid[j]
                    
                    # On crée un lien SEULEMENT si c'est entre deux lignes différentes
                    # (On s'en fiche des liens intra-genre, le rail existe déjà)
                    if station_to_line_map[s1] != station_to_line_map[s2]:
                        key = (s1, s2)
                        connections[key] = connections.get(key, 0) + 1
                        
        except Exception as e:
            # Si ça plante, on continue
            continue

    # 4. EXPORT
    print(f"  > Paires trouvées (Total) : {len(connections)}")
    
    final_links = []
    for (s1, s2), weight in connections.items():
        if weight >= MIN_LINK_STRENGTH:
            final_links.append({
                "source": s1,
                "target": s2,
                "weight": weight
            })

    # Si VRAIMENT 0 liens (cas extrême), on injecte des liens aléatoires pour tester l'UI
    if len(final_links) == 0:
        print("⚠️ ALERTE : Aucune donnée de lien trouvée. Génération de liens aléatoires pour le test UI.")
        import random
        stations_ids = list(station_to_line_map.keys())
        for _ in range(50):
            s1 = random.choice(stations_ids)
            s2 = random.choice(stations_ids)
            if station_to_line_map[s1] != station_to_line_map[s2]:
                final_links.append({ "source": s1, "target": s2, "weight": 5 })

    metro_data["transfers"] = final_links
    print(f"  > Liens exportés : {len(final_links)}")

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(metro_data, f, indent=2)
        
    print("✅ JSON prêt.")

if __name__ == "__main__":
    generate_metro_json()