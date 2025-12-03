import os
import json
import random

# --- CONFIGURATION ---
INPUT_JSON = 'metro_data_enriched.json' # Ton fichier avec les infos textuelles
OUTPUT_JSON = 'metro_data_local.json'   # Le fichier final pour le site
MUSIC_DIR = 'music'

def link_files():
    print("--- LIAISON DES FICHIERS LOCAUX ---")
    
    # 1. Scanner le dossier music
    if not os.path.exists(MUSIC_DIR):
        print(f"❌ Erreur : Le dossier '{MUSIC_DIR}' n'existe pas.")
        return

    # Récupérer la liste des fichiers mp3 disponibles (ex: ['26397.mp3', '61478.mp3'])
    available_files = [f for f in os.listdir(MUSIC_DIR) if f.endswith('.mp3')]
    
    if not available_files:
        print(f"❌ Erreur : Aucun MP3 trouvé dans '{MUSIC_DIR}'. Ajoute tes 3 fichiers.")
        return

    print(f"📂 {len(available_files)} fichiers trouvés : {available_files}")
    
    # On extrait les IDs (sans l'extension .mp3) pour comparer
    # set() permet une recherche ultra-rapide
    available_ids = set([f.split('.')[0] for f in available_files])

    # 2. Charger le JSON
    try:
        with open(INPUT_JSON, 'r', encoding='utf-8') as f:
            metro_data = json.load(f)
    except FileNotFoundError:
        print(f"❌ Fichier {INPUT_JSON} manquant. Lance 'add_fma_tracks_final.py' d'abord.")
        return

    count_real = 0
    count_fake = 0

    # 3. Mettre à jour les URLs
    for station in metro_data['stations']:
        if 'playlist' not in station: continue
        
        for track in station['playlist']:
            track_id = str(track['id']) # On convertit en string pour comparer
            
            if track_id in available_ids:
                # CAS 1 : C'est un de tes 3 vrais fichiers !
                track['url'] = f"{MUSIC_DIR}/{track_id}.mp3"
                # On ajoute un petit marqueur pour le voir dans la console JS
                track['is_real'] = True 
                count_real += 1
            else:
                # CAS 2 : Le fichier manque (téléchargement pas fini)
                # On assigne un de tes 3 fichiers au hasard pour que ça joue quand même
                random_backup = random.choice(available_files)
                track['url'] = f"{MUSIC_DIR}/{random_backup}"
                track['is_real'] = False
                count_fake += 1

    # 4. Sauvegarder
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(metro_data, f, indent=2)

    print("-" * 30)
    print(f"✅ {count_real} liens réels créés (tes 3 sons).")
    print(f"⚠️ {count_fake} liens de substitution créés (pour tester le reste).")
    print(f"📁 Fichier prêt : {OUTPUT_JSON}")

if __name__ == "__main__":
    link_files()