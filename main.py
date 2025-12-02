import pandas as pd
import os
import ast

# Configuration
DATA_DIR = './data'

def load_data():
    print("Chargement des données... (cela peut prendre quelques secondes)")
    
    # 1. Chargement des Genres
    # genres.csv est simple : index_col=0 permet d'utiliser l'ID du genre comme index
    genres = pd.read_csv(os.path.join(DATA_DIR, 'genres.csv'), index_col=0)
    
    # 2. Chargement des Tracks
    # Attention : tracks.csv a 3 lignes d'en-tête (Header). 
    # On charge tout, l'index est la colonne 0 (track_id)
    tracks = pd.read_csv(os.path.join(DATA_DIR, 'tracks.csv'), index_col=0, header=[0, 1, 2])
    
    # On simplifie : on ne garde que la partie ('track', ...) et on filtre le subset 'small' ou 'medium' si besoin
    # Pour l'instant, regardons la colonne ('track', 'genre_top') qui contient souvent la racine
    return genres, tracks

def analyze_metro_topology(genres, tracks):
    print("\n--- ANALYSE DE LA TOPOLOGIE DU MÉTRO ---")
    
    # ÉTAPE A : Identifier les Lignes (Racines)
    # Dans FMA, une racine a parent_id = 0
    root_genres = genres[genres['parent'] == 0]
    
    print(f"Nombre de lignes détectées (Genres Racines) : {len(root_genres)}")
    
    # ÉTAPE B : Calculer la 'population' de chaque ligne
    # On regarde combien de morceaux sont taggés avec ce 'genre_top' dans tracks.csv
    # Note: tracks['track']['genre_top'] contient le nom du genre racine
    
    track_counts = tracks['track']['genre_top'].value_counts()
    
    metro_lines = []
    
    for genre_id, row in root_genres.iterrows():
        genre_name = row['title']
        # Combien de morceaux pour ce genre ? (0 si pas trouvé dans le dataset tracks)
        count = track_counts.get(genre_name, 0)
        
        # On calcule aussi combien de sous-stations (sous-genres) existent pour cette ligne
        # On cherche tous les genres qui ont ce parent_id ou dont le parent remonte à cet ID
        # Pour faire simple ici : on compte les enfants directs
        sub_stations_count = len(genres[genres['parent'] == genre_id])
        
        metro_lines.append({
            "id": genre_id,
            "name": genre_name,
            "tracks_available": count,
            "sub_stations_direct": sub_stations_count
        })

    # Tri par popularité (nombre de tracks) pour voir les lignes principales
    metro_lines.sort(key=lambda x: x['tracks_available'], reverse=True)
    
    print(f"\n{'ID':<5} | {'NOM DE LA LIGNE (GENRE)':<20} | {'TRACKS':<10} | {'SOUS-STATIONS'}")
    print("-" * 60)
    for line in metro_lines:
        print(f"{line['id']:<5} | {line['name']:<20} | {line['tracks_available']:<10} | {line['sub_stations_direct']}")

    return metro_lines

# --- Exécution ---
if __name__ == "__main__":
    try:
        if not os.path.exists(os.path.join(DATA_DIR, 'tracks.csv')):
            print(f"ERREUR: Fichiers introuvables dans {DATA_DIR}. Vérifiez l'emplacement.")
        else:
            genres_df, tracks_df = load_data()
            lines = analyze_metro_topology(genres_df, tracks_df)
            
            print("\nSUCCÈS : Données chargées. Prêt pour l'export JSON.")
            
    except Exception as e:
        print(f"Une erreur est survenue : {e}")