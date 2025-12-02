let metroData;
let lines = [];
let stations = [];
let transfers = [];
let stationMap = {};
let lineDirectionMap = {}; 

// --- CONFIGURATION ---
const GRID_SIZE = 70;      // Espace large
const STATION_SIZE = 14;   
const LINE_WIDTH = 12;     
const SEED = 999;          // J'ai changé la seed pour un résultat plus aéré

// Variables internes
let takenCells = new Set();
let adjacencyList = {};
let selectedStart = null;
let selectedEnd = null;
let currentPath = [];

// Caméra & Interaction
let mapScale = 1, mapOffsetX = 0, mapOffsetY = 0;
let isDragging = false;

const DIRS = [
  {x: 1, y: 0}, {x: -1, y: 0}, {x: 0, y: 1}, {x: 0, y: -1}, 
  {x: 1, y: 1}, {x: 1, y: -1}, {x: -1, y: 1}, {x: -1, y: -1} 
];

function preload() {
  metroData = loadJSON('metro_data.json');
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('Arial, Helvetica, sans-serif');
  
  generateOptimizedLayout(SEED);
  applyParallelLineAdjustment(); // On garde tes lignes parallèles !
  buildSpatialGraph(); 
  calculateInitialCameraFit();
}

function draw() {
  background(252, 250, 245); 

  push(); 
  translate(mapOffsetX, mapOffsetY);
  scale(mapScale);

  // Conversion souris
  let mouseWorldX = (mouseX - mapOffsetX) / mapScale;
  let mouseWorldY = (mouseY - mapOffsetY) / mapScale;
  let isPathActive = currentPath.length > 0;

  // 1. DESSIN DES LIGNES
  noFill();
  strokeJoin(ROUND);
  strokeCap(PROJECT);

  let groups = groupStationsByLine();
  for (let pass = 0; pass < 2; pass++) {
      for (let lineId in groups) {
        let lineStations = groups[lineId];
        let lineObj = lines.find(l => l.line_id == lineId);
        if (!lineObj || lineStations.length < 2) continue;

        let isDimmed = isPathActive; 

        beginShape();
        if (pass === 0) { // Ombre
             strokeWeight(LINE_WIDTH + 2); 
             stroke(0, 0, 0, 15);
             for (let s of lineStations) vertex(s.x + 3, s.y + 3);
        } else { // Ligne
             strokeWeight(LINE_WIDTH); 
             stroke(isDimmed ? color(220) : lineObj.color); 
             for (let s of lineStations) vertex(s.x, s.y);
        }
        endShape();
      }
  }

  // 2. CHEMIN GPS
  if (isPathActive) {
    noFill(); stroke(50); strokeWeight(LINE_WIDTH); strokeJoin(ROUND);
    beginShape();
    for (let s of currentPath) vertex(s.x, s.y);
    endShape();
  }

  // 3. STATIONS & TEXTES
  let hubs = detectHubs();
  
  // A. Stations simples
  for (let s of stations) {
     if (isStationInHub(s, hubs)) continue;
     
     let isStart = selectedStart === s;
     let isEnd = selectedEnd === s;
     let onPath = currentPath.includes(s);
     
     strokeWeight(2);
     if (isStart) { fill(0, 200, 0); stroke(0); circle(s.x, s.y, STATION_SIZE + 6); }
     else if (isEnd) { fill(200, 0, 0); stroke(0); circle(s.x, s.y, STATION_SIZE + 6); }
     else if (onPath) { fill(255); stroke(0); circle(s.x, s.y, STATION_SIZE); } 
     else {
         stroke(s.lineColor); fill(255);
         circle(s.x, s.y, STATION_SIZE);
     }

     // Labels intelligents (en biais pour éviter le pâté)
     if (!isPathActive || onPath || isStart || isEnd) {
         let angle = calculateLabelAngle(s);
         drawAngledLabel(s, false, angle);
     }
  }

  // B. Hubs
  for (let hub of hubs) {
      let isStartHub = hub.stations.includes(selectedStart);
      let isEndHub = hub.stations.includes(selectedEnd);
      let onPathHub = hub.stations.some(s => currentPath.includes(s));
      
      strokeWeight(2);
      if(isStartHub) { stroke(0); fill(0, 200, 0); }
      else if(isEndHub) { stroke(0); fill(200, 0, 0); }
      else if(onPathHub && isPathActive) { stroke(0); fill(255); } 
      else { stroke(0); fill(255); }

      rectMode(CENTER);
      let w = STATION_SIZE + (hub.stations.length * 4);
      let h = STATION_SIZE + 4;
      rect(hub.x, hub.y, w, h, 8);
      
      if (!isPathActive || onPathHub || isStartHub || isEndHub) {
          drawAngledLabel(hub.stations[0], true, -PI/4); 
      }
  }

  pop(); 
  drawLegend();
}

// --- OPTIMISATION DU PLACEMENT (ANTI-PÂTÉ) ---
function generateOptimizedLayout(seed) {
  randomSeed(seed);
  takenCells.clear();
  let rawLines = Object.values(metroData.lines);
  let rawStations = Object.values(metroData.stations);
  if (metroData.transfers) transfers = metroData.transfers;

  // Tri par connectivité
  let connectivity = {};
  rawLines.forEach(l => connectivity[l.line_id] = 0);
  transfers.forEach(t => {
      let l1 = getLineID(t.source, rawStations);
      let l2 = getLineID(t.target, rawStations);
      if(l1 && l2 && l1 !== l2) { connectivity[l1]++; connectivity[l2]++; }
  });
  rawLines.sort((a, b) => connectivity[b.line_id] - connectivity[a.line_id]);

  let placedLines = new Set();
  
  // -- C'EST ICI QUE CA CHANGE --
  // On divise l'espace en secteurs pour chaque ligne principale
  // Cela force l'explosion vers l'extérieur
  let angleStep = TWO_PI / Math.max(1, rawLines.length);

  for (let i = 0; i < rawLines.length; i++) {
      let lineData = rawLines[i];
      let lineStations = rawStations.filter(s => s.line_id === lineData.line_id);
      if (lineStations.length === 0) continue; 
      lineStations.sort((a,b) => a.station_id - b.station_id);

      let anchor = null;
      // On cherche une ancre (connexion existante)
      for (let s of lineStations) {
          let connectedStationID = getConnectedStationID(s.station_id, placedLines);
          if (connectedStationID !== null) {
              let targetS = stationMap[connectedStationID];
              if (targetS) { anchor = { myStation: s, targetX: targetS.x, targetY: targetS.y }; break; }
          }
      }

      // Calcul de la direction de fuite (Secteur)
      let sectorAngle = i * angleStep;
      // On trouve l'index de direction (0-7) qui matche le mieux l'angle
      let preferredDirIdx = getBestDirIndexFromAngle(sectorAngle);
      lineDirectionMap[lineData.line_id] = preferredDirIdx; // On sauvegarde pour la suite

      if (anchor) {
          // On s'accroche
          anchor.myStation.x = anchor.targetX; anchor.myStation.y = anchor.targetY;
          markOccupied(anchor.targetX, anchor.targetY);
      } else {
          // PAS D'ANCRE = ON PART LOIN DU CENTRE
          // On calcule un point de départ sur un cercle
          let startRadius = GRID_SIZE * 4; // Assez loin
          let startX = Math.round((Math.cos(sectorAngle) * startRadius) / GRID_SIZE) * GRID_SIZE;
          let startY = Math.round((Math.sin(sectorAngle) * startRadius) / GRID_SIZE) * GRID_SIZE;
          
          let spot = findFreeSpot(startX, startY);
          
          // On place le milieu de la ligne ici
          let midIdx = Math.floor(lineStations.length / 2);
          if (lineStations[midIdx]) {
              lineStations[midIdx].x = spot.x; lineStations[midIdx].y = spot.y;
              markOccupied(spot.x, spot.y);
          }
      }

      let placedIndices = lineStations.map((s, idx) => (s.x !== undefined ? idx : -1)).filter(idx => idx !== -1);
      
      // Si échec placement (rare), on force au centre mais décalé
      if (placedIndices.length === 0 && lineStations.length > 0) { 
          let backupX = Math.round((Math.cos(sectorAngle) * GRID_SIZE * 5)/GRID_SIZE)*GRID_SIZE;
          let backupY = Math.round((Math.sin(sectorAngle) * GRID_SIZE * 5)/GRID_SIZE)*GRID_SIZE;
          lineStations[0].x = backupX; lineStations[0].y = backupY;
          markOccupied(backupX, backupY); placedIndices.push(0);
      }

      // Déroulement de la ligne (Snake)
      if (placedIndices.length > 0) {
          for (let j = placedIndices[0] - 1; j >= 0; j--) {
              placeNextStation(lineStations[j+1], lineStations[j], preferredDirIdx);
          }
          for (let j = placedIndices[placedIndices.length-1] + 1; j < lineStations.length; j++) {
              placeNextStation(lineStations[j-1], lineStations[j], preferredDirIdx);
          }
      }
      lines.push(lineData);
      lineStations.forEach(s => {
          s.lineColor = lineData.color;
          stationMap[s.station_id] = s;
          stations.push(s);
      });
      placedLines.add(lineData.line_id);
  }
}

function placeNextStation(prevS, currentS, preferredDirIdx) {
    if (prevS.x === undefined || prevS.y === undefined) return;
    let candidates = [];
    
    // On teste toutes les directions
    for (let dIndex = 0; dIndex < DIRS.length; dIndex++) {
        let dir = DIRS[dIndex];
        let tx = prevS.x + dir.x * GRID_SIZE;
        let ty = prevS.y + dir.y * GRID_SIZE;
        
        // Strictement interdit de marcher sur une case occupée
        if (!isOccupiedByLine(tx, ty, currentS.line_id)) {
            let score = myRandom();
            // Gros bonus pour la direction du secteur (pour fuir le centre)
            if (dIndex === preferredDirIdx) score += 2.0; 
            // Bonus pour continuer tout droit (éviter les zigzags inutiles)
            // (nécessiterait l'historique, ici simplifié)
            
            candidates.push({ x: tx, y: ty, score: score });
        }
    }
    
    if (candidates.length === 0) {
        // Bloqué ? On fait un saut (tunnel) vers une zone libre dans la direction préférée
        let jumpDir = DIRS[preferredDirIdx];
        let spot = findFreeSpot(prevS.x + jumpDir.x * GRID_SIZE * 2, prevS.y + jumpDir.y * GRID_SIZE * 2);
        currentS.x = spot.x; currentS.y = spot.y;
    } else {
        candidates.sort((a, b) => b.score - a.score);
        currentS.x = candidates[0].x; currentS.y = candidates[0].y;
    }
    markOccupied(currentS.x, currentS.y);
}

function getBestDirIndexFromAngle(angle) {
    let maxDot = -Infinity;
    let bestIdx = 0;
    let cx = Math.cos(angle); let cy = Math.sin(angle);
    for(let i=0; i<DIRS.length; i++) {
        let d = DIRS[i];
        let len = Math.sqrt(d.x*d.x + d.y*d.y);
        let dx = d.x / len; let dy = d.y / len;
        let dot = dx*cx + dy*cy;
        if(dot > maxDot) { maxDot = dot; bestIdx = i; }
    }
    return bestIdx;
}

// --- AFFICHAGE TEXTE EN BIAIS ---
function calculateLabelAngle(s) {
    // Par défaut : -45 degrés
    let defaultAngle = -PI / 4; 
    let checkX = s.x + GRID_SIZE;
    let checkY = s.y - GRID_SIZE;
    // Si la case en haut à droite est prise, on bascule le texte
    if (takenCells.has(makeKey(checkX, checkY))) return PI / 4;
    return defaultAngle;
}

function drawAngledLabel(s, isHub, angle) {
    push();
    translate(s.x, s.y);
    let dist = isHub ? 28 : 18;
    rotate(angle);
    textAlign(LEFT, CENTER); textSize(12); textStyle(BOLD);
    stroke(255, 255, 255, 230); strokeWeight(4); noFill();
    text(s.name, dist, 0); 
    noStroke(); fill(0);
    text(s.name, dist, 0);
    pop();
}

// --- PARALLEL ADJUSTMENT (Ton code existant) ---
function applyParallelLineAdjustment() {
    if (!transfers || transfers.length === 0) return;
    let pairCounts = {};
    for (let t of transfers) {
        let s1 = stationMap[t.source]; let s2 = stationMap[t.target];
        if (!s1 || !s2) continue;
        let l1 = String(s1.line_id); let l2 = String(s2.line_id);
        if (l1 === l2) continue;
        let key = l1 < l2 ? l1 + "-" + l2 : l2 + "-" + l1;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
    }
    let keys = Object.keys(pairCounts).sort((a, b) => pairCounts[b] - pairCounts[a]);
    let alreadyAdjusted = new Set();
    for (let key of keys) {
        if (pairCounts[key] < 3) break; 
        let [lA, lB] = key.split("-");
        if (alreadyAdjusted.has(lA) || alreadyAdjusted.has(lB)) continue;
        makeLinesParallel(lA, lB);
        alreadyAdjusted.add(lA); alreadyAdjusted.add(lB);
    }
}
function makeLinesParallel(lineAId, lineBId) {
    lineAId = String(lineAId); lineBId = String(lineBId);
    let lineAStations = stations.filter(s => String(s.line_id) === lineAId && s.x !== undefined).sort((a, b) => a.station_id - b.station_id);
    let lineBStations = stations.filter(s => String(s.line_id) === lineBId && s.x !== undefined).sort((a, b) => a.station_id - b.station_id);
    if (lineAStations.length < 2 || lineBStations.length < 2) return;
    let anchorA = null, anchorB = null;
    for (let t of transfers) {
        let s1 = stationMap[t.source]; let s2 = stationMap[t.target];
        if (!s1 || !s2) continue;
        let l1 = String(s1.line_id); let l2 = String(s2.line_id);
        if ((l1 === lineAId && l2 === lineBId) || (l1 === lineBId && l2 === lineAId)) {
            if (l1 === lineAId) { anchorA = s1; anchorB = s2; } else { anchorA = s2; anchorB = s1; }
            break;
        }
    }
    if (!anchorA || !anchorB) return;
    let idxA = lineAStations.findIndex(s => s.station_id === anchorA.station_id);
    if (idxA === -1) return;
    let dir = { x: 0, y: 0 };
    if (idxA > 0) { dir.x += anchorA.x - lineAStations[idxA - 1].x; dir.y += anchorA.y - lineAStations[idxA - 1].y; }
    if (idxA < lineAStations.length - 1) { dir.x += lineAStations[idxA + 1].x - anchorA.x; dir.y += lineAStations[idxA + 1].y - anchorA.y; }
    let len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
    if (!len) { dir.x = 1; len=1; }
    dir.x /= len; dir.y /= len;
    let perp = { x: -dir.y, y: dir.x };
    let offset = LINE_WIDTH * 1.5;
    let n = Math.min(lineAStations.length, lineBStations.length);
    for (let i = 0; i < n; i++) {
        let sA = lineAStations[i]; let sB = lineBStations[i];
        if (sB.station_id === anchorB.station_id) { sB.x = sA.x; sB.y = sA.y; }
        else { sB.x = sA.x + perp.x * offset; sB.y = sA.y + perp.y * offset; }
    }
}

// --- UTILS & INTERACTIONS ---
function getConnectedStationID(stationID, validLineIDs) {
    for (let t of transfers) {
        let neighbor = null;
        if (t.source === stationID) neighbor = t.target;
        if (t.target === stationID) neighbor = t.source;
        if (neighbor) {
            let neighborLine = getLineOfStation(neighbor, Object.values(metroData.stations));
            if (validLineIDs.has(neighborLine)) return neighbor;
        }
    }
    return null;
}
function getLineOfStation(sid, allStations) { let s = allStations.find(st => st.station_id === sid); return s ? s.line_id : null; }
function getLineID(sid, allS) { let f = allS.find(s => s.station_id === sid); return f ? f.line_id : null; }
function findFreeSpot(cx, cy) {
    let r = 0;
    while(r < 100) {
        for(let angle=0; angle<TWO_PI; angle+=0.5) {
            let tx = cx + Math.round(Math.cos(angle)*r)*GRID_SIZE;
            let ty = cy + Math.round(Math.sin(angle)*r)*GRID_SIZE;
            if(!takenCells.has(makeKey(tx,ty))) return {x:tx, y:ty};
        }
        r++;
    }
    return {x:cx, y:cy};
}
function markOccupied(x, y) { takenCells.add(makeKey(x,y)); }
function makeKey(x, y) { return x + "," + y; }
function isOccupiedByLine(x, y, lineId) { return takenCells.has(makeKey(x, y)); }
let _seed = 12345;
function randomSeed(s) { _seed = s; }
function myRandom() { _seed = (_seed * 9301 + 49297) % 233280; return _seed / 233280; }
function detectHubs() {
    let map = {}; let hubs = [];
    for(let s of stations) {
        if(s.x === undefined) continue;
        let k = Math.round(s.x) + "," + Math.round(s.y); 
        if(!map[k]) map[k] = [];
        map[k].push(s);
    }
    for(let k in map) { if(map[k].length > 1) hubs.push({x: map[k][0].x, y: map[k][0].y, stations: map[k]}); }
    return hubs;
}
function isStationInHub(s, hubs) { for(let h of hubs) { if(dist(s.x, s.y, h.x, h.y) < 2) return true; } return false; }
function groupStationsByLine() {
    let g = {};
    for(let s of stations) {
        if(s.x === undefined) continue;
        if(!g[s.line_id]) g[s.line_id] = [];
        g[s.line_id].push(s);
    }
    return g;
}
function calculateInitialCameraFit() {
    if (stations.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let s of stations) {
        if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
        if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
    }
    let margin = GRID_SIZE * 3;
    let w = maxX - minX + margin*2; let h = maxY - minY + margin*2;
    mapScale = Math.min(width/w, height/h); mapScale = Math.min(mapScale, 1.2); mapScale = max(mapScale, 0.2);
    let cx = (minX + maxX)/2; let cy = (minY + maxY)/2;
    mapOffsetX = width/2 - cx * mapScale; mapOffsetY = height/2 - cy * mapScale;
}
function buildSpatialGraph() {
  adjacencyList = {};
  for (let s of stations) adjacencyList[s.station_id] = [];
  let groups = groupStationsByLine();
  for(let id in groups) {
      let arr = groups[id];
      for(let i=0; i<arr.length-1; i++) {
          let u = arr[i]; let v = arr[i+1];
          if(dist(u.x, u.y, v.x, v.y) < GRID_SIZE * 3) {
             adjacencyList[u.station_id].push(v.station_id); adjacencyList[v.station_id].push(u.station_id);
          }
      }
  }
  for (let i = 0; i < stations.length; i++) {
      for (let j = i + 1; j < stations.length; j++) {
          let s1 = stations[i]; let s2 = stations[j];
          if (s1.line_id === s2.line_id) continue;
          if (dist(s1.x, s1.y, s2.x, s2.y) < 5) {
              adjacencyList[s1.station_id].push(s2.station_id); adjacencyList[s2.station_id].push(s1.station_id);
          }
      }
  }
}
function drawLegend() {
    let padding = 15; let itemHeight = 22; let boxWidth = 220;
    let uniqueLines = []; let seenIds = new Set();
    for(let l of lines) { if(!seenIds.has(l.line_id)) { uniqueLines.push(l); seenIds.add(l.line_id); } }
    let boxHeight = uniqueLines.length * itemHeight + padding * 2;
    let startX = width - boxWidth - 20; let startY = height - boxHeight - 20;
    if(mouseX > startX && mouseY > startY) isDragging = true;
    fill(255, 240); stroke(200); strokeWeight(1); rectMode(CORNER);
    rect(startX, startY, boxWidth, boxHeight, 8);
    textAlign(LEFT, CENTER); textSize(11); textStyle(BOLD);
    for (let i = 0; i < uniqueLines.length; i++) {
        let l = uniqueLines[i]; let y = startY + padding + i * itemHeight;
        fill(l.color); noStroke(); circle(startX + 20, y, 12);
        fill(50); text(l.name.toUpperCase(), startX + 35, y);
    }
}
function mouseWheel(event) {
    let s = 1 - event.delta * 0.001; let newScale = constrain(mapScale * s, 0.1, 5.0);
    let wx = (mouseX - mapOffsetX) / mapScale; let wy = (mouseY - mapOffsetY) / mapScale;
    mapOffsetX = mouseX - wx * newScale; mapOffsetY = mouseY - wy * newScale;
    mapScale = newScale; return false;
}
function mouseDragged() { isDragging = true; mapOffsetX += movedX; mapOffsetY += movedY; }
function mousePressed() { isDragging = false; }
function mouseReleased() { if (isDragging) return; handleSelectionClick(); }
function handleSelectionClick() {
  let mx = (mouseX - mapOffsetX) / mapScale; let my = (mouseY - mapOffsetY) / mapScale;
  let clickedStation = null;
  for (let s of stations) { if (dist(mx, my, s.x, s.y) < STATION_SIZE + 5) { clickedStation = s; break; } }
  if (!clickedStation) {
      let hubs = detectHubs();
      for (let h of hubs) {
          let w = STATION_SIZE + (h.stations.length * 4);
          if (dist(mx, my, h.x, h.y) < w/1.5) { clickedStation = h.stations[0]; break; }
      }
  }
  if (clickedStation) {
    if (!selectedStart) { selectedStart = clickedStation; selectedEnd = null; currentPath = []; }
    else if (!selectedEnd) { selectedEnd = clickedStation; findPath(selectedStart, selectedEnd); }
    else { selectedStart = clickedStation; selectedEnd = null; currentPath = []; }
  } else { selectedStart = null; selectedEnd = null; currentPath = []; }
}
function findPath(start, end) {
  let queue = [[start.station_id]]; let visited = new Set(); visited.add(start.station_id);
  while(queue.length > 0) {
      let path = queue.shift(); let lastId = path[path.length-1];
      if (lastId === end.station_id) { currentPath = path.map(id => stations.find(s => s.station_id === id)); return; }
      let neighbors = adjacencyList[lastId] || [];
      for (let n of neighbors) { if (!visited.has(n)) { visited.add(n); queue.push([...path, n]); } }
  }
  alert("Pas de connexion !"); currentPath = [];
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); calculateInitialCameraFit(); }