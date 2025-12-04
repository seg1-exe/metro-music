let metroData;
let lines = [];
let stations = [];
let transfers = [];
let stationMap = {};
let lineDirectionMap = {}; 

// --- CONFIGURATION ---
const GRID_SIZE = 70;      
const STATION_SIZE = 14;   
const LINE_WIDTH = 12;     
const SEED = 12345;        

// Audio
const CROSSFADE_DURATION = 2000; 
const STATION_DURATION = 15000; 
let activeIntervals = [];

// Variables internes
let takenCells = new Set();
let adjacencyList = {};
let selectedStart = null;
let selectedEnd = null;
let currentPath = [];

// Voyage
let isJourneyActive = false;
let journeyTimer = 0;
let trainPos = null;
let currentStationIdx = 0;
let nextTimeout = null;

// Caméra
let mapScale = 1, mapOffsetX = 0, mapOffsetY = 0;
let minZoomScale = 0.2;
let isDragging = false;
let canvasWrapper;

// Audio
let playerA = new Audio(); playerA.crossOrigin = "anonymous";
let playerB = new Audio(); playerB.crossOrigin = "anonymous";
let activeDeck = 'A';
let currentManualTrackUrl = null; 

const DIRS = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}];

function preload() { metroData = loadJSON('metro_data_local.json'); }

function setup() {
  canvasWrapper = select('#canvas-wrapper');
  let c = createCanvas(canvasWrapper.width, canvasWrapper.height);
  c.parent('canvas-wrapper'); 
  textFont('Helvetica Neue, Helvetica, Arial, sans-serif');
  
  generateOptimizedLayout(SEED);
  applyParallelLineAdjustment();
  buildSpatialGraph(); 
  calculateInitialCameraFit();
  
  initSidebarNavigation();
  initMiniPlayerEvents();
}

function draw() {
  background(253, 251, 247); 
  push(); 
  translate(mapOffsetX, mapOffsetY);
  scale(mapScale);

  let isPathActive = currentPath.length > 0;

  // LIGNES
  noFill(); strokeJoin(ROUND); strokeCap(PROJECT);
  let groups = groupStationsByLine();
  for (let pass = 0; pass < 2; pass++) {
      for (let lineId in groups) {
        let lineStations = groups[lineId];
        let lineObj = lines.find(l => l.line_id == lineId);
        if (!lineObj || lineStations.length < 2) continue;
        let isDimmed = isPathActive && selectedLegendLine === null;
        if (selectedLegendLine !== null && lineId != selectedLegendLine) isDimmed = true;

        beginShape();
        if (pass === 0) { strokeWeight(LINE_WIDTH + 2); stroke(0, 0, 0, 15); for (let s of lineStations) vertex(s.x + 3, s.y + 3); } 
        else { strokeWeight(LINE_WIDTH); stroke(isDimmed ? color(220) : lineObj.color); for (let s of lineStations) vertex(s.x, s.y); }
        endShape();
      }
  }

  // CHEMIN
  if (isPathActive) {
    noFill(); stroke(50); strokeWeight(LINE_WIDTH); strokeJoin(ROUND);
    beginShape(); for (let s of currentPath) vertex(s.x, s.y); endShape();
  }

  // STATIONS
  let hubs = detectHubs();
  for (let s of stations) {
     if (isStationInHub(s, hubs)) continue;
     let isStart = selectedStart === s; let isEnd = selectedEnd === s; let onPath = currentPath.includes(s);
     let isDimmed = false;
     if (isPathActive && !onPath && !isStart && !isEnd) isDimmed = true;
     if (selectedLegendLine !== null && s.line_id != selectedLegendLine) isDimmed = true;
     
     strokeWeight(2);
     if (isStart) { fill(0, 200, 0); stroke(0); circle(s.x, s.y, STATION_SIZE + 6); }
     else if (isEnd) { fill(200, 0, 0); stroke(0); circle(s.x, s.y, STATION_SIZE + 6); }
     else if (onPath && isPathActive) { fill(255); stroke(0); circle(s.x, s.y, STATION_SIZE); } 
     else { stroke(isDimmed ? color(200) : s.lineColor); fill(isDimmed ? color(240) : 255); circle(s.x, s.y, STATION_SIZE); }
     if (!isDimmed) drawAngledLabel(s, false, calculateLabelAngle(s));
  }
  for (let hub of hubs) {
      let isStartHub = hub.stations.includes(selectedStart); let isEndHub = hub.stations.includes(selectedEnd);
      let onPathHub = hub.stations.some(s => currentPath.includes(s));
      let isHubVisible = true;
      if (selectedLegendLine !== null) isHubVisible = hub.stations.some(s => s.line_id == selectedLegendLine);
      if (isPathActive && !onPathHub && !isStartHub && !isEndHub) isHubVisible = false;

      if(isHubVisible){
        strokeWeight(2);
        if(isStartHub) { stroke(0); fill(0, 200, 0); } else if(isEndHub) { stroke(0); fill(200, 0, 0); }
        else if(onPathHub && isPathActive) { stroke(0); fill(255); } else { stroke(0); fill(255); }
        rectMode(CENTER);
        let w = STATION_SIZE + (hub.stations.length * 4); let h = STATION_SIZE + 4;
        rect(hub.x, hub.y, w, h, 8);
        drawAngledLabel(hub.stations[0], true, -PI/4);
      }
  }

  // TRAIN
  if (isJourneyActive && trainPos) {
      updateTrainPosition(); 
      fill(0); noStroke(); circle(trainPos.x, trainPos.y, 20);
      fill(255); textAlign(CENTER, CENTER); textSize(10); text("♫", trainPos.x, trainPos.y);
      noFill(); stroke(0, 100); strokeWeight(2);
      let pulse = (millis() % 1000) / 20;
      circle(trainPos.x, trainPos.y, 20 + pulse);
  }
  pop(); 
}

// --- LOGIQUE MINI LECTEUR ---
function updateMiniPlayer(trackTitle, artistName, subgenre, color) {
    // On s'assure que le lecteur est visible
    let player = select('#mini-player');
    if (player) player.style('display', 'flex');

    select('#mp-track').html(trackTitle);
    select('#mp-artist').html(artistName);
    select('#mp-genre').html(subgenre);
    select('#mp-cover').style('background', color);
    select('#mp-control').html('⏸'); 
}

function resetMiniPlayer() {
    select('#mp-track').html("En attente...");
    select('#mp-artist').html("Sélectionnez un titre");
    select('#mp-genre').html("");
    select('#mp-cover').style('background', '#333');
    select('#mp-control').html('▶');
    // Optionnel : Masquer le lecteur si inactif
    // select('#mini-player').style('display', 'none'); 
}

function initMiniPlayerEvents() {
    let btn = select('#mp-control');
    if (!btn) return;

    btn.mousePressed(() => {
        if (currentManualTrackUrl) {
            // Lecture Manuelle
            if (playerA.paused) { 
                playerA.play(); 
                btn.html('⏸'); 
                // MAJ de l'icône dans la liste
                let playingRow = select('.track-item.playing .play-icon');
                if(playingRow) playingRow.html('⏸');
            } else { 
                playerA.pause(); 
                btn.html('▶'); 
                let playingRow = select('.track-item.playing .play-icon');
                if(playingRow) playingRow.html('▶');
            }
        } 
        else if (isJourneyActive) {
             // Voyage Automatique
             if (playerA.paused && playerB.paused) { 
                 stopJourney(true); 
                 resetMiniPlayer();
             } else { 
                 playerA.pause(); playerB.pause(); 
                 if(nextTimeout) clearTimeout(nextTimeout); 
                 btn.html('▶'); 
             }
        }
    });
}

// --- SIDEBAR NAVIGATION ---
let selectedLegendLine = null; 

function initSidebarNavigation() { renderMainGenres(); }

function renderMainGenres() {
    selectedLegendLine = null; 
    let navContent = select('#navigation-content');
    navContent.html('');
    
    let ul = createElement('ul').addClass('nav-list').parent(navContent);
    let uniqueLines = []; let seenIds = new Set();
    for(let l of lines) { if(!seenIds.has(l.line_id)) { uniqueLines.push(l); seenIds.add(l.line_id); } }
    uniqueLines.sort((a,b) => a.name.localeCompare(b.name));

    uniqueLines.forEach(line => {
        let li = createElement('li').addClass('nav-item').parent(ul);
        createElement('span').addClass('genre-dot').style('background', line.color).parent(li);
        createSpan(line.name.toUpperCase()).parent(li);
        li.mousePressed(() => renderSubgenres(line));
    });
}

function renderSubgenres(lineObj) {
    selectedLegendLine = lineObj.line_id; 
    let navContent = select('#navigation-content');
    navContent.html('');

    let backBtn = createDiv('← RETOUR AUX GENRES').addClass('nav-item back-button').parent(navContent);
    backBtn.mousePressed(renderMainGenres);

    let headerDiv = createDiv('').addClass('nav-header').parent(navContent);
    createElement('span').addClass('genre-dot').style('background', lineObj.color).parent(headerDiv);
    createSpan(lineObj.name.toUpperCase()).style('font-weight','bold').style('font-size','24px').parent(headerDiv);

    let ul = createElement('ul').addClass('nav-list').parent(navContent);
    let lineStats = stations.filter(s => s.line_id == lineObj.line_id);
    lineStats.sort((a,b) => a.name.localeCompare(b.name));

    lineStats.forEach(station => {
        let li = createElement('li').addClass('nav-item').parent(ul);
        createElement('span').addClass('subgenre-dot').style('background', lineObj.color).parent(li);
        createSpan(station.name).parent(li);
        li.mousePressed(() => renderTracks(station, lineObj));
    });
}

function renderTracks(station, lineObj) {
    let navContent = select('#navigation-content');
    navContent.html('');

    let backBtn = createDiv('← RETOUR À ' + lineObj.name.toUpperCase())
        .addClass('nav-item back-button')
        .parent(navContent);
    backBtn.mousePressed(() => renderSubgenres(lineObj));

    createDiv(station.name)
        .style('font-weight','bold')
        .style('margin-bottom','20px')
        .style('font-size','24px')
        .parent(navContent);

    if (!station.playlist || station.playlist.length === 0) {
        createDiv("Aucun morceau disponible.")
            .style('opacity','0.6')
            .parent(navContent);
        return;
    }

    station.playlist.forEach(track => {
        // Conteneur de la ligne
        let trackItem = createDiv('')
            .addClass('track-item')
            .parent(navContent);
        
        let info = createDiv('')
            .addClass('track-info')
            .parent(trackItem);

        createDiv(track.title)
            .addClass('track-title')
            .parent(info);
        createDiv(track.artist)
            .addClass('track-artist')
            .parent(info);
        
        let btnIcon = '▶';
        if (currentManualTrackUrl === track.url && !playerA.paused) {
            btnIcon = '⏸';
            trackItem.addClass('playing');
        }
        
        let playBtn = createDiv(btnIcon)
            .addClass('play-icon')
            .parent(trackItem);

        playBtn.id('btn-' + track.id); 

        // IMPORTANT : on passe trackItem à playTrackManual
        trackItem.mousePressed(() => {
            updateMiniPlayer(track.title, track.artist, station.name, lineObj.color);
            playTrackManual(track, playBtn, trackItem);
        });
    });
}


// --- LECTURE MANUELLE CORRIGÉE (AVEC ARGUMENT CONTAINER) ---
function playTrackManual(track, btnDiv, containerDiv) {
    // Même morceau cliqué à nouveau
    if (currentManualTrackUrl === track.url) {
        if (playerA.paused) {
            playerA.play();
            btnDiv.html('⏸');
            containerDiv.addClass('playing');
            select('#mp-control').html('⏸');
        } else {
            playerA.pause();
            btnDiv.html('▶');
            containerDiv.removeClass('playing');
            select('#mp-control').html('▶');
        }
        return;
    }
    
    // Nouveau morceau → on stoppe le voyage automatique
    stopJourney(true);
    killAllFades();
    
    // Reset visuel global
    selectAll('.play-icon').forEach(el => el.html('▶'));
    selectAll('.track-item').forEach(el => el.removeClass('playing'));

    // Prépare et joue
    playerA.src = track.url;
    playerA.currentTime = 0;
    playerA.volume = 1.0; 
    playerA.play().catch(e => console.error(e));
    
    currentManualTrackUrl = track.url;
    
    // Mise à jour de l'UI pour CE morceau
    btnDiv.html('⏸');
    containerDiv.addClass('playing');
    select('#mp-control').html('⏸');

    // Quand la lecture se termine
    playerA.onended = () => {
        btnDiv.html('▶');
        containerDiv.removeClass('playing');
        currentManualTrackUrl = null;
        resetMiniPlayer();
    };
}


// --- INTERACTION CAMERA ---
function mouseWheel(event) {
    if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
    let s = 1 - event.delta * 0.001; 
    let newScale = constrain(mapScale * s, minZoomScale, 5.0);
    let wx = (mouseX - mapOffsetX) / mapScale; let wy = (mouseY - mapOffsetY) / mapScale;
    mapOffsetX = mouseX - wx * newScale; mapOffsetY = mouseY - wy * newScale;
    mapScale = newScale; 
    if (abs(mapScale - minZoomScale) < 0.001) calculateInitialCameraFit();
    return false; 
}
function mouseDragged() { if (mapScale > minZoomScale * 1.01) { isDragging = true; mapOffsetX += movedX; mapOffsetY += movedY; } }
function mousePressed() { isDragging = false; }
function mouseReleased() { if (isDragging) return; if (mouseX > 0 && mouseX < width && mouseY > 0 && mouseY < height) handleSelectionClick(); }
function windowResized() { canvasWrapper = select('#canvas-wrapper'); resizeCanvas(canvasWrapper.width, canvasWrapper.height); calculateInitialCameraFit(); }

// --- LOGIQUE VOYAGE ---
function handleSelectionClick() {
  // Reset manuel si clic map
  if (currentManualTrackUrl) { 
      playerA.pause(); 
      currentManualTrackUrl = null; 
      selectAll('.play-icon').forEach(el => el.html('▶')); 
      selectAll('.track-item').forEach(el => el.removeClass('playing'));
      resetMiniPlayer(); 
  }

  let mx = (mouseX - mapOffsetX) / mapScale; let my = (mouseY - mapOffsetY) / mapScale;
  let clickedStation = null;
  for (let s of stations) { if (dist(mx, my, s.x, s.y) < STATION_SIZE + 5) { clickedStation = s; break; } }
  if (!clickedStation) { let hubs = detectHubs(); for (let h of hubs) { let w = STATION_SIZE + (h.stations.length * 4); if (dist(mx, my, h.x, h.y) < w/1.5) { clickedStation = h.stations[0]; break; } } }
  
  if (clickedStation) {
    if (!selectedStart) { selectedStart = clickedStation; selectedEnd = null; currentPath = []; }
    else if (!selectedEnd) { selectedEnd = clickedStation; findPath(selectedStart, selectedEnd); }
    else { selectedStart = clickedStation; selectedEnd = null; currentPath = []; stopJourney(false); resetMiniPlayer(); }
  } else { 
      // Clic dans le vide = RESET TOUT
      selectedStart = null; selectedEnd = null; currentPath = []; 
      stopJourney(false); 
      resetMiniPlayer(); 
  }
}

function findPath(start, end) {
  let queue = [[start.station_id]]; let visited = new Set(); visited.add(start.station_id);
  while(queue.length > 0) {
      let path = queue.shift(); let lastId = path[path.length-1];
      if (lastId === end.station_id) { currentPath = path.map(id => stations.find(s => s.station_id === id)); startMusicalJourney(); return; }
      let neighbors = adjacencyList[lastId] || [];
      for (let n of neighbors) { if (!visited.has(n)) { visited.add(n); queue.push([...path, n]); } }
  }
  alert("Pas de connexion physique !"); currentPath = [];
}

function startMusicalJourney() { 
    stopJourney(true); 
    if (currentPath.length === 0) return; 
    isJourneyActive = true; 
    currentStationIdx = 0; 
    playCurrentStep(); 
}

function playCurrentStep() {
    if (nextTimeout) clearTimeout(nextTimeout);
    if (currentStationIdx >= currentPath.length) { stopJourney(false); resetMiniPlayer(); return; }
    
    let station = currentPath[currentStationIdx];
    let isHub = false; let hubs = detectHubs(); for(let h of hubs) { if(h.stations.some(s => s.station_id === station.station_id)) { if(h.stations.length > 2) isHub = true; break; }}
    let stationStopTime = isHub ? 5000 : 2000; 
    journeyTimer = millis(); trainPos = createVector(station.x, station.y);
    
    if (station.playlist && station.playlist.length > 0) {
        let track = random(station.playlist);
        
        // MAJ MINI PLAYER VOYAGE (SANS EFFACER)
        let lineObj = lines.find(l => l.line_id == station.line_id);
        updateMiniPlayer(track.title, track.artist, station.name, lineObj ? lineObj.color : '#fff');
        
        crossfadeToTrack(track.url);
        nextTimeout = setTimeout(() => { currentStationIdx++; playCurrentStep(); }, STATION_DURATION + stationStopTime);
    } else { 
        nextTimeout = setTimeout(() => { currentStationIdx++; playCurrentStep(); }, 2000 + stationStopTime); 
    }
}

function updateTrainPosition() {
    if (currentStationIdx >= currentPath.length - 1) { let finalS = currentPath[currentPath.length - 1]; trainPos = createVector(finalS.x, finalS.y); return; }
    let startS = currentPath[currentStationIdx]; let nextS = currentPath[currentStationIdx + 1];
    let elapsed = millis() - journeyTimer; let progress = constrain(elapsed / STATION_DURATION, 0, 1);
    trainPos = createVector(lerp(startS.x, nextS.x, progress), lerp(startS.y, nextS.y, progress));
}

// --- STOP JOURNEY CORRIGÉ ---
// ATTENTION : Ne JAMAIS mettre resetMiniPlayer() ici si hardStop est true
function stopJourney(hardStop = false) { 
    isJourneyActive = false; 
    if (nextTimeout) clearTimeout(nextTimeout); 
    if (hardStop) { killAllFades(); playerA.pause(); playerB.pause(); } 
    else { fadeOut(playerA); fadeOut(playerB); }
}

function crossfadeToTrack(url) {
    killAllFades();
    let incoming = (activeDeck === 'A') ? playerB : playerA; let outgoing = (activeDeck === 'A') ? playerA : playerB;
    incoming.pause(); incoming.src = url; incoming.volume = 0; incoming.currentTime = 0;
    let playPromise = incoming.play();
    if (playPromise !== undefined) { playPromise.then(() => { performFade(incoming, 0, 1); performFade(outgoing, outgoing.volume, 0); }).catch(error => { console.error(error); if(isJourneyActive) { if(nextTimeout) clearTimeout(nextTimeout); setTimeout(() => { currentStationIdx++; playCurrentStep(); }, 1000); }}); }
    activeDeck = (activeDeck === 'A') ? 'B' : 'A';
}
function performFade(player, startVol, endVol) {
    let steps = 20; let stepTime = CROSSFADE_DURATION / steps; let volStep = (endVol - startVol) / steps; let currentStep = 0;
    let interval = setInterval(() => { currentStep++; let newVol = Math.max(0, Math.min(1, startVol + (volStep * currentStep))); try { player.volume = newVol; } catch(e) {} if (currentStep >= steps) { clearInterval(interval); if (endVol === 0) { player.pause(); player.currentTime = 0; }} }, stepTime);
    activeIntervals.push(interval);
}
function fadeOut(player) { performFade(player, player.volume, 0); }
function killAllFades() { for (let i = 0; i < activeIntervals.length; i++) clearInterval(activeIntervals[i]); activeIntervals = []; }

// --- UTILS (Inchangé - Fonctions techniques) ---
function calculateInitialCameraFit() { if (stations.length === 0) return; let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; for (let s of stations) { if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x; if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y; } let margin = GRID_SIZE * 2; let w = maxX - minX + margin*2; let h = maxY - minY + margin*2; minZoomScale = Math.min(width/w, height/h); minZoomScale = constrain(minZoomScale, 0.15, 1.0); mapScale = minZoomScale; let cx = (minX + maxX)/2; let cy = (minY + maxY)/2; mapOffsetX = width/2 - cx * mapScale; mapOffsetY = height/2 - cy * mapScale; }
function getConnectedStationID(stationID, validLineIDs) { for (let t of transfers) { let neighbor = null; if (t.source === stationID) neighbor = t.target; if (t.target === stationID) neighbor = t.source; if (neighbor) { let neighborLine = getLineOfStation(neighbor, Object.values(metroData.stations)); if (validLineIDs.has(neighborLine)) return neighbor; } } return null; }
function getLineOfStation(sid, allStations) { let s = allStations.find(st => st.station_id === sid); return s ? s.line_id : null; }
function getLineID(sid, allS) { let f = allS.find(s => s.station_id === sid); return f ? f.line_id : null; }
function findFreeSpot(cx, cy) { let r = 0; while(r < 200) { for(let angle=0; angle<TWO_PI; angle+=0.5) { let tx = cx + Math.round(Math.cos(angle)*r)*GRID_SIZE; let ty = cy + Math.round(Math.sin(angle)*r)*GRID_SIZE; if(!takenCells.has(makeKey(tx,ty))) return {x:tx, y:ty}; } r++; } return {x:cx, y:cy}; }
function markOccupied(x, y) { takenCells.add(makeKey(x,y)); }
function makeKey(x, y) { return x + "," + y; }
function isOccupiedByLine(x, y, lineId) { return takenCells.has(makeKey(x, y)); }
function randomSeed(s) { /* p5 */ } function myRandom() { return random(); }
function detectHubs() { let map = {}; let hubs = []; for(let s of stations) { if(s.x === undefined) continue; let k = Math.round(s.x) + "," + Math.round(s.y); if(!map[k]) map[k] = []; map[k].push(s); } for(let k in map) { if(map[k].length > 1) hubs.push({x: map[k][0].x, y: map[k][0].y, stations: map[k]}); } return hubs; }
function isStationInHub(s, hubs) { for(let h of hubs) { if(dist(s.x, s.y, h.x, h.y) < 2) return true; } return false; }
function groupStationsByLine() { let g = {}; for(let s of stations) { if(s.x === undefined) continue; if(!g[s.line_id]) g[s.line_id] = []; g[s.line_id].push(s); } return g; }
function buildSpatialGraph() { adjacencyList = {}; for (let s of stations) adjacencyList[s.station_id] = []; let groups = groupStationsByLine(); for(let id in groups) { let arr = groups[id]; for(let i=0; i<arr.length-1; i++) { let u = arr[i]; let v = arr[i+1]; if(dist(u.x, u.y, v.x, v.y) < GRID_SIZE * 3) { adjacencyList[u.station_id].push(v.station_id); adjacencyList[v.station_id].push(u.station_id); } } } for (let i = 0; i < stations.length; i++) { for (let j = i + 1; j < stations.length; j++) { let s1 = stations[i]; let s2 = stations[j]; if (s1.line_id === s2.line_id) continue; if (dist(s1.x, s1.y, s2.x, s2.y) < 5) { adjacencyList[s1.station_id].push(s2.station_id); adjacencyList[s2.station_id].push(s1.station_id); } } } }
function generateOptimizedLayout(seed) { randomSeed(seed); takenCells.clear(); let rawLines = Object.values(metroData.lines); let rawStations = Object.values(metroData.stations); if (metroData.transfers) transfers = metroData.transfers; let connectivity = {}; rawLines.forEach(l => connectivity[l.line_id] = 0); transfers.forEach(t => { let l1 = getLineID(t.source, rawStations); let l2 = getLineID(t.target, rawStations); if(l1 && l2 && l1 !== l2) { connectivity[l1]++; connectivity[l2]++; } }); rawLines.sort((a, b) => connectivity[b.line_id] - connectivity[a.line_id]); let placedLines = new Set(); let angleStep = TWO_PI / Math.max(1, rawLines.length); for (let i = 0; i < rawLines.length; i++) { let lineData = rawLines[i]; let lineStations = rawStations.filter(s => s.line_id === lineData.line_id); if (lineStations.length === 0) continue; lineStations.sort((a,b) => a.station_id - b.station_id); let anchor = null; for (let s of lineStations) { let connectedStationID = getConnectedStationID(s.station_id, placedLines); if (connectedStationID !== null) { let targetS = stationMap[connectedStationID]; if (targetS) { anchor = { myStation: s, targetX: targetS.x, targetY: targetS.y }; break; } } } let sectorAngle = i * angleStep; let preferredDirIdx = getBestDirIndexFromAngle(sectorAngle); lineDirectionMap[lineData.line_id] = preferredDirIdx; if (anchor) { anchor.myStation.x = anchor.targetX; anchor.myStation.y = anchor.targetY; markOccupied(anchor.targetX, anchor.targetY); } else { let startRadius = GRID_SIZE * 4; let startX = Math.round((Math.cos(sectorAngle) * startRadius) / GRID_SIZE) * GRID_SIZE; let startY = Math.round((Math.sin(sectorAngle) * startRadius) / GRID_SIZE) * GRID_SIZE; let spot = findFreeSpot(startX, startY); let midIdx = Math.floor(lineStations.length / 2); if (lineStations[midIdx]) { lineStations[midIdx].x = spot.x; lineStations[midIdx].y = spot.y; markOccupied(spot.x, spot.y); } } let placedIndices = lineStations.map((s, idx) => (s.x !== undefined ? idx : -1)).filter(idx => idx !== -1); if (placedIndices.length === 0 && lineStations.length > 0) { let backupX = Math.round((Math.cos(sectorAngle) * GRID_SIZE * 5)/GRID_SIZE)*GRID_SIZE; let backupY = Math.round((Math.sin(sectorAngle) * GRID_SIZE * 5)/GRID_SIZE)*GRID_SIZE; lineStations[0].x = backupX; lineStations[0].y = backupY; markOccupied(backupX, backupY); placedIndices.push(0); } if (placedIndices.length > 0) { for (let j = placedIndices[0] - 1; j >= 0; j--) { placeNextStation(lineStations[j+1], lineStations[j], preferredDirIdx); } for (let j = placedIndices[placedIndices.length-1] + 1; j < lineStations.length; j++) { placeNextStation(lineStations[j-1], lineStations[j], preferredDirIdx); } } lines.push(lineData); lineStations.forEach(s => { s.lineColor = lineData.color; stationMap[s.station_id] = s; stations.push(s); }); placedLines.add(lineData.line_id); } }
function placeNextStation(prevS, currentS, preferredDirIdx) { if (prevS.x === undefined || prevS.y === undefined) return; let candidates = []; for (let dIndex = 0; dIndex < DIRS.length; dIndex++) { let dir = DIRS[dIndex]; let tx = prevS.x + dir.x * GRID_SIZE; let ty = prevS.y + dir.y * GRID_SIZE; if (!isOccupiedByLine(tx, ty, currentS.line_id)) { let score = random(); if (dIndex === preferredDirIdx) score += 2.0; candidates.push({ x: tx, y: ty, score: score }); } } if (candidates.length === 0) { let jumpDir = DIRS[preferredDirIdx]; let spot = findFreeSpot(prevS.x + jumpDir.x * GRID_SIZE * 2, prevS.y + jumpDir.y * GRID_SIZE * 2); currentS.x = spot.x; currentS.y = spot.y; } else { candidates.sort((a, b) => b.score - a.score); currentS.x = candidates[0].x; currentS.y = candidates[0].y; } markOccupied(currentS.x, currentS.y); }
function applyParallelLineAdjustment() { if (!transfers || transfers.length === 0) return; let pairCounts = {}; for (let t of transfers) { let s1 = stationMap[t.source]; let s2 = stationMap[t.target]; if (!s1 || !s2) continue; let l1 = String(s1.line_id); let l2 = String(s2.line_id); if (l1 === l2) continue; let key = l1 < l2 ? l1 + "-" + l2 : l2 + "-" + l1; pairCounts[key] = (pairCounts[key] || 0) + 1; } let keys = Object.keys(pairCounts).sort((a, b) => pairCounts[b] - pairCounts[a]); let alreadyAdjusted = new Set(); for (let key of keys) { if (pairCounts[key] < 3) break; let [lA, lB] = key.split("-"); if (alreadyAdjusted.has(lA) || alreadyAdjusted.has(lB)) continue; makeLinesParallel(lA, lB); alreadyAdjusted.add(lA); alreadyAdjusted.add(lB); } }
function makeLinesParallel(lineAId, lineBId) { lineAId = String(lineAId); lineBId = String(lineBId); let lineAStations = stations.filter(s => String(s.line_id) === lineAId && s.x !== undefined).sort((a, b) => a.station_id - b.station_id); let lineBStations = stations.filter(s => String(s.line_id) === lineBId && s.x !== undefined).sort((a, b) => a.station_id - b.station_id); if (lineAStations.length < 2 || lineBStations.length < 2) return; let anchorA = null, anchorB = null; for (let t of transfers) { let s1 = stationMap[t.source]; let s2 = stationMap[t.target]; if (!s1 || !s2) continue; let l1 = String(s1.line_id); let l2 = String(s2.line_id); if ((l1 === lineAId && l2 === lineBId) || (l1 === lineBId && l2 === lineAId)) { if (l1 === lineAId) { anchorA = s1; anchorB = s2; } else { anchorA = s2; anchorB = s1; } break; } } if (!anchorA || !anchorB) return; let idxA = lineAStations.findIndex(s => s.station_id === anchorA.station_id); if (idxA === -1) return; let dir = { x: 0, y: 0 }; if (idxA > 0) { dir.x += anchorA.x - lineAStations[idxA - 1].x; dir.y += anchorA.y - lineAStations[idxA - 1].y; } if (idxA < lineAStations.length - 1) { dir.x += lineAStations[idxA + 1].x - anchorA.x; dir.y += lineAStations[idxA + 1].y - anchorA.y; } let len = Math.sqrt(dir.x * dir.x + dir.y * dir.y); if (!len) { dir.x = 1; len=1; } dir.x /= len; dir.y /= len; let perp = { x: -dir.y, y: dir.x }; let offset = LINE_WIDTH * 1.5; let n = Math.min(lineAStations.length, lineBStations.length); for (let i = 0; i < n; i++) { let sA = lineAStations[i]; let sB = lineBStations[i]; if (sB.station_id === anchorB.station_id) { sB.x = sA.x; sB.y = sA.y; } else { sB.x = sA.x + perp.x * offset; sB.y = sA.y + perp.y * offset; } } }
function getBestDirIndexFromAngle(angle) { let maxDot = -Infinity; let bestIdx = 0; let cx = Math.cos(angle); let cy = Math.sin(angle); for(let i=0; i<DIRS.length; i++) { let d = DIRS[i]; let len = Math.sqrt(d.x*d.x + d.y*d.y); let dx = d.x / len; let dy = d.y / len; let dot = dx*cx + dy*cy; if(dot > maxDot) { maxDot = dot; bestIdx = i; } } return bestIdx; }
function calculateLabelAngle(s) { let defaultAngle = -PI / 4; let checkX = s.x + GRID_SIZE; let checkY = s.y - GRID_SIZE; if (takenCells.has(makeKey(checkX, checkY))) return PI / 4; return defaultAngle; }
function drawAngledLabel(s, isHub, angle) { push(); translate(s.x, s.y); let dist = isHub ? 28 : 18; rotate(angle); textAlign(LEFT, CENTER); textSize(13); textStyle(BOLD); stroke(255, 255, 255, 230); strokeWeight(4); noFill(); text(s.name, dist, 0); noStroke(); fill(0); text(s.name, dist, 0); pop(); }