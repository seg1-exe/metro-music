let metroData;
let lines = [];
let stations = [];
let transfers = [];
let stationMap = {};
let lineDirectionMap = {};

// --- CONFIG ---
const GRID_SIZE = 100;
const STATION_SIZE = 15;
const LINE_WIDTH = 8;
const SEED = 12345;

// Audio
const CROSSFADE_DURATION = 2000;
const STATION_DURATION = 15000;
let activeIntervals = [];

// Internal state
let takenCells = new Set();
let adjacencyList = {};
let cachedHubs = null;
let cachedGroups = null;
let cachedTopTransfers = null;
let cachedMediumTransfers = null;
let selectedStart = null;
let selectedEnd = null;
let currentPath = [];

// Journey
let isJourneyActive = false;
let journeyTimer = 0;
let trainPos = null;
let currentStationIdx = 0;
let nextTimeout = null;
let stepEndTime = 0;
let journeyPauseTime = 0;

// Camera
let mapScale = 1, mapOffsetX = 0, mapOffsetY = 0;
let minZoomScale = 0.2;
let isDragging = false;
let canvasWrapper;

// Intro animation
let introActive = true;
let introStartTime = 0;
const INTRO_DURATION = 1500;
let mapCenter = null;
let maxMapDistance = 0;

// Selected line animation
let lineAnimConfig = {
    active: false,
    lineId: null,
    startTime: 0,
    center: null,
    maxDist: 0
};

// Grid bounds
let mapBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

// Audio
let playerA = new Audio();
let playerB = new Audio();
playerA.onerror = () => { console.error('Audio file not found:', playerA.src); select('#mp-track').elt.textContent = 'File not found'; select('#mp-artist').elt.textContent = ''; };
playerB.onerror = () => { console.error('Audio file not found:', playerB.src); };
let activeDeck = 'A';
let currentManualTrackUrl = null;

const DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }];

function preload() { metroData = loadJSON('metro_data_local.json'); }

function setup() {
    canvasWrapper = select('#canvas-wrapper');
    let c = createCanvas(canvasWrapper.width, canvasWrapper.height);
    c.parent('canvas-wrapper');
    textFont('Helvetica');
    initTouchHandlers(c.elt);

    generateOptimizedLayout(SEED);
    applyParallelLineAdjustment();
    applySecondaryColocations();
    buildSpatialGraph();
    calculateInitialCameraFit();
    let sortedT = [...transfers].sort((a, b) => (b.strength || 0) - (a.strength || 0));
    cachedTopTransfers = sortedT.slice(0, 50);
    cachedMediumTransfers = sortedT.slice(50);
    cachedHubs = detectHubs();
    cachedGroups = groupStationsByLine();

    initSidebarNavigation();
    initMiniPlayerEvents();
}

function draw() {
    background(253, 251, 247);
    push();
    translate(mapOffsetX, mapOffsetY);
    scale(mapScale);

    // GRID
    drawGrid();

    // INTRO
    let currentRadius = Infinity;
    if (introActive && mapCenter) {
        let elapsed = millis() - introStartTime;
        if (elapsed < INTRO_DURATION) {
            let progress = easeOutCubic(elapsed / INTRO_DURATION);
            currentRadius = progress * maxMapDistance;
        } else {
            introActive = false;
        }
    }

    let isPathActive = currentPath.length > 0;

    // LINES
    noFill(); strokeJoin(ROUND); strokeCap(ROUND);
    let groups = cachedGroups;
    for (let pass = 0; pass < 2; pass++) {
        for (let lineId in groups) {
            let lineStations = groups[lineId];
            let lineObj = lines.find(l => l.line_id == lineId);
            if (!lineObj || lineStations.length < 2) continue;
            let isDimmed = isPathActive && selectedLegendLine === null;
            if (selectedLegendLine !== null && lineId != selectedLegendLine) isDimmed = true;

            if (introActive) {
                drawClippedPath(insertWaypoints(lineStations), currentRadius, mapCenter, pass, isDimmed, lineObj);
            }
            // SELECTED LINE ANIMATION
            else if (lineAnimConfig.active && lineAnimConfig.lineId == lineId) {
                let elapsed = millis() - lineAnimConfig.startTime;
                let animRadius = Infinity;
                if (elapsed < INTRO_DURATION) {
                    let progress = easeOutCubic(elapsed / INTRO_DURATION);
                    animRadius = progress * lineAnimConfig.maxDist;
                }

                // Animation done: draw normally to avoid flickering
                if (elapsed >= INTRO_DURATION) {
                    let pts = insertWaypoints(lineStations);
                    beginShape();
                    if (pass === 0) { strokeWeight(LINE_WIDTH + 2); stroke(0, 0, 0, 15); for (let s of pts) vertex(s.x + 3, s.y + 3); }
                    else { strokeWeight(LINE_WIDTH); stroke(isDimmed ? color(220) : lineObj.color); for (let s of pts) vertex(s.x, s.y); }
                    endShape();
                } else {
                    drawClippedPath(insertWaypoints(lineStations), animRadius, lineAnimConfig.center, pass, isDimmed, lineObj);
                }
            }
            else {
                let pts = insertWaypoints(lineStations);
                beginShape();
                if (pass === 0) { strokeWeight(LINE_WIDTH + 2); stroke(0, 0, 0, 15); for (let s of pts) vertex(s.x + 3, s.y + 3); }
                else { strokeWeight(LINE_WIDTH); stroke(isDimmed ? color(220) : lineObj.color); for (let s of pts) vertex(s.x, s.y); }
                endShape();
            }
        }
    }

    // JOURNEY PATH (colored by line, routed)
    if (isPathActive) {
        strokeJoin(ROUND); strokeCap(ROUND);
        // Group consecutive stations by line for continuous drawing
        let i = 0;
        while (i < currentPath.length) {
            let segStart = i;
            let currentLineId = currentPath[i].line_id;
            while (i < currentPath.length && currentPath[i].line_id === currentLineId) i++;
            let seg = currentPath.slice(segStart, i);
            if (seg.length < 2) continue;
            let lineObj = lines.find(l => l.line_id == currentLineId);
            let pts = insertWaypoints(seg);
            // Shadow
            stroke(0, 0, 0, 35); strokeWeight(LINE_WIDTH + 5);
            beginShape(); for (let p of pts) vertex(p.x + 2, p.y + 2); endShape();
            // Colored thick stroke
            stroke(lineObj ? lineObj.color : color(50)); strokeWeight(LINE_WIDTH + 3);
            beginShape(); for (let p of pts) vertex(p.x, p.y); endShape();
            // White center highlight for tube effect
            stroke(255, 255, 255, 80); strokeWeight(LINE_WIDTH - 3);
            beginShape(); for (let p of pts) vertex(p.x, p.y); endShape();
        }
    }

    // STATIONS
    let hubs = cachedHubs;
    for (let s of stations) {
        if (introActive && mapCenter && dist(s.x, s.y, mapCenter.x, mapCenter.y) > currentRadius) continue;
        if (isStationInHub(s, hubs)) continue;
        let isStart = selectedStart === s; let isEnd = selectedEnd === s; let onPath = currentPath.includes(s);
        let isDimmed = false;
        if (isPathActive && !onPath && !isStart && !isEnd) isDimmed = true;
        if (selectedLegendLine !== null && s.line_id != selectedLegendLine) isDimmed = true;

        // Check if terminus (first or last station on the line)
        let lineGroup = cachedGroups[s.line_id];
        let isTerminus = lineGroup && lineGroup.length > 0 && (lineGroup[0] === s || lineGroup[lineGroup.length - 1] === s);

        strokeWeight(3);
        if (isStart) {
            fill(0, 200, 0); stroke(255); circle(s.x, s.y, STATION_SIZE + 4);
        } else if (isEnd) {
            fill(200, 0, 0); stroke(255); circle(s.x, s.y, STATION_SIZE + 4);
        } else if (isTerminus) {
            // Terminus: larger white circle with thick colored border
            stroke(isDimmed ? color(190) : s.lineColor); strokeWeight(4);
            fill(isDimmed ? color(240) : 255); circle(s.x, s.y, STATION_SIZE + 4);
        } else if (onPath && isPathActive) {
            stroke(0); strokeWeight(3); fill(255); circle(s.x, s.y, STATION_SIZE);
        } else {
            stroke(isDimmed ? color(190) : s.lineColor); fill(isDimmed ? color(235) : 255); circle(s.x, s.y, STATION_SIZE);
        }
        if (!isDimmed) drawAngledLabel(s, false, calculateLabelAngle(s));
    }
    for (let hub of hubs) {
        let isStartHub = hub.stations.includes(selectedStart); let isEndHub = hub.stations.includes(selectedEnd);
        let onPathHub = hub.stations.some(s => currentPath.includes(s));
        let isHubVisible = true;
        if (introActive && mapCenter && dist(hub.x, hub.y, mapCenter.x, mapCenter.y) > currentRadius) isHubVisible = false;
        if (selectedLegendLine !== null) isHubVisible = hub.stations.some(s => s.line_id == selectedLegendLine);
        if (isPathActive && !onPathHub && !isStartHub && !isEndHub) isHubVisible = false;

        if (isHubVisible) {
            let n = hub.stations.length;
            let w = STATION_SIZE + n * 6; let h = STATION_SIZE + 2;
            rectMode(CENTER);
            if (isStartHub) { strokeWeight(3); stroke(255); fill(0, 200, 0); rect(hub.x, hub.y, w, h, h / 2); }
            else if (isEndHub) { strokeWeight(3); stroke(255); fill(200, 0, 0); rect(hub.x, hub.y, w, h, h / 2); }
            else {
                // Multi-line hub capsule: white pill shape with per-line color dots
                strokeWeight(4); stroke(0); fill(255); rect(hub.x, hub.y, w, h, h / 2);
                noStroke(); let dotW = 4; let startX = hub.x - (n - 1) * (dotW + 2) / 2;
                hub.stations.forEach((s, i) => {
                    let lineObj = lines.find(l => l.line_id == s.line_id);
                    if (lineObj) { fill(lineObj.color); rect(startX + i * (dotW + 2), hub.y + h / 2 + 4, dotW, 3, 1); }
                });
            }
            drawHubLabel(hub, -PI / 4);
        }
    }

    // TRAIN MARKER
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

// --- MINI PLAYER ---
function updateMiniPlayer(trackTitle, artistName, subgenre, color) {
    let player = select('#mini-player');
    if (player) player.style('display', 'flex');

    select('#mp-track').elt.textContent = trackTitle;
    select('#mp-artist').elt.textContent = artistName;
    select('#mp-genre').elt.textContent = subgenre;
    select('#mp-cover').style('background', color);
    select('#mp-control').html('⏸');
}

function resetMiniPlayer() {
    select('#mp-track').html("Waiting...");
    select('#mp-artist').html("Select a track");
    select('#mp-genre').html("");
    select('#mp-cover').style('background', '#333');
    select('#mp-control').html('▶');
    select('#mini-player').style('display', 'none');
}

function initMiniPlayerEvents() {
    let btn = select('#mp-control');
    if (!btn) return;

    onTap(btn.elt, () => {
        if (currentManualTrackUrl) {
            // Manual playback
            if (playerA.paused) {
                playerA.play();
                btn.html('⏸');
                let playingRow = select('.track-item.playing .play-icon');
                if (playingRow) playingRow.html('⏸');
            } else {
                playerA.pause();
                btn.html('▶');
                let playingRow = select('.track-item.playing .play-icon');
                if (playingRow) playingRow.html('▶');
            }
        }
        else if (isJourneyActive) {
            // Journey playback
            if (playerA.paused && playerB.paused) {
                // Resume: adjust timers to account for pause duration
                let pauseDuration = millis() - journeyPauseTime;
                journeyTimer += pauseDuration;
                playerA.play().catch(e => {});
                let remaining = Math.max(100, stepEndTime + pauseDuration - millis());
                nextTimeout = setTimeout(() => { currentStationIdx++; playCurrentStep(); }, remaining);
                btn.html('⏸');
            } else {
                playerA.pause(); playerB.pause();
                if (nextTimeout) clearTimeout(nextTimeout);
                journeyPauseTime = millis();
                btn.html('▶');
            }
        }
    });
}

// --- SIDEBAR ---

let selectedLegendLine = null;

function initSidebarNavigation() { renderMainGenres(); }

function renderMainGenres() {
    selectedLegendLine = null;
    let navContent = select('#navigation-content');
    navContent.html('');

    let ul = createElement('ul').addClass('nav-list').parent(navContent);
    let uniqueLines = []; let seenIds = new Set();
    for (let l of lines) { if (!seenIds.has(l.line_id)) { uniqueLines.push(l); seenIds.add(l.line_id); } }
    uniqueLines.sort((a, b) => a.name.localeCompare(b.name));

    uniqueLines.forEach(line => {
        let li = createElement('li').addClass('nav-item').parent(ul);
        createElement('span').addClass('genre-dot').style('background', line.color).parent(li);
        createSpan(line.name.toUpperCase()).parent(li);
        onTap(li.elt, () => renderSubgenres(line));
    });
}

function renderSubgenres(lineObj) {
    selectedLegendLine = lineObj.line_id;

    // TRIGGER ANIMATION
    lineAnimConfig.active = true;
    lineAnimConfig.lineId = lineObj.line_id;
    lineAnimConfig.startTime = millis();
    lineAnimConfig.center = mapCenter;

    // Max distance from center for this line
    let localMax = 0;
    let relevantStations = stations.filter(s => s.line_id == lineObj.line_id);
    for (let s of relevantStations) {
        let d = dist(s.x, s.y, mapCenter.x, mapCenter.y);
        if (d > localMax) localMax = d;
    }
    lineAnimConfig.maxDist = localMax + GRID_SIZE;

    let navContent = select('#navigation-content');
    navContent.html('');

    let backBtn = createDiv('← BACK TO GENRES').addClass('nav-item back-button').parent(navContent);
    onTap(backBtn.elt, renderMainGenres);

    let headerDiv = createDiv('').addClass('nav-header').parent(navContent);
    createElement('span').addClass('genre-dot').style('background', lineObj.color).parent(headerDiv);
    createSpan(lineObj.name.toUpperCase()).style('font-weight', 'bold').style('font-size', '24px').parent(headerDiv);

    let ul = createElement('ul').addClass('nav-list').parent(navContent);
    let lineStats = stations.filter(s => s.line_id == lineObj.line_id);
    lineStats.sort((a, b) => a.name.localeCompare(b.name));

    lineStats.forEach(station => {
        let li = createElement('li').addClass('nav-item').parent(ul);
        createElement('span').addClass('subgenre-dot').style('background', lineObj.color).parent(li);
        createSpan(station.name).parent(li);
        onTap(li.elt, () => renderTracks(station, lineObj));
    });
}

function renderTracks(station, lineObj) {
    let navContent = select('#navigation-content');
    navContent.html('');

    let backBtn = createDiv('← BACK TO ' + lineObj.name.toUpperCase())
        .addClass('nav-item back-button')
        .parent(navContent);
    onTap(backBtn.elt, () => renderSubgenres(lineObj));

    createDiv(station.name)
        .style('font-weight', 'bold')
        .style('margin-bottom', '20px')
        .style('font-size', '24px')
        .parent(navContent);

    if (!station.playlist || station.playlist.length === 0) {
        createDiv("No tracks available.")
            .style('opacity', '0.6')
            .parent(navContent);
        return;
    }

    station.playlist.forEach(track => {
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

        onTap(trackItem.elt, () => {
            updateMiniPlayer(track.title, track.artist, station.name, lineObj.color);
            playTrackManual(track, playBtn, trackItem);
        });
    });
}


// --- MANUAL PLAYBACK ---
function playTrackManual(track, btnDiv, containerDiv) {
    // Same track clicked again
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

    // New track: stop any active journey
    stopJourney(true);
    killAllFades();

    selectAll('.play-icon').forEach(el => el.html('▶'));
    selectAll('.track-item').forEach(el => el.removeClass('playing'));

    playerA.src = track.url;
    playerA.currentTime = 0;
    playerA.volume = 1.0;
    playerA.play().catch(e => console.error(e));

    currentManualTrackUrl = track.url;

    btnDiv.html('⏸');
    containerDiv.addClass('playing');
    select('#mp-control').html('⏸');

    playerA.onended = () => {
        btnDiv.html('▶');
        containerDiv.removeClass('playing');
        currentManualTrackUrl = null;
        resetMiniPlayer();
    };
}


// --- CAMERA ---
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
function mouseDragged() { if (touches.length > 0) return; if (mapScale > minZoomScale * 1.01) { isDragging = true; mapOffsetX += movedX; mapOffsetY += movedY; } }
function mousePressed() { isDragging = false; }
function mouseReleased() { if (isDragging) return; if (mouseX > 0 && mouseX < width && mouseY > 0 && mouseY < height) handleSelectionClick(); }
function windowResized() { canvasWrapper = select('#canvas-wrapper'); resizeCanvas(canvasWrapper.width, canvasWrapper.height); calculateInitialCameraFit(); }

// Reliable tap handler for sidebar DOM elements:
// fires on touchend (no 300ms delay) and prevents the synthetic click
// from double-firing. Falls back to click on desktop.
function onTap(el, fn) {
    let startY = 0;
    let didTouch = false;
    el.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        didTouch = true;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (Math.abs(e.changedTouches[0].clientY - startY) < 10) {
            e.preventDefault(); // stop synthetic click from firing
            fn();
        }
        setTimeout(() => { didTouch = false; }, 500);
    }, { passive: false });
    el.addEventListener('click', () => { if (!didTouch) fn(); }); // desktop only
}

// --- TOUCH SUPPORT (attached directly to canvas in setup) ---
function initTouchHandlers(canvasEl) {
    // Tell the browser we handle all touch gestures on this element
    canvasEl.style.touchAction = 'none';
    let _prevTouchDist = null;
    let _prevTouchMid = null;
    let _touchStartPos = null;
    let _touchMoved = false;

    canvasEl.addEventListener('touchstart', (event) => {
        event.preventDefault();
        _touchMoved = false;
        if (event.touches.length === 1) {
            _prevTouchDist = null;
            _prevTouchMid = null;
            _touchStartPos = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        } else if (event.touches.length === 2) {
            _touchStartPos = null;
            let t0 = event.touches[0], t1 = event.touches[1];
            _prevTouchDist = dist(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
            _prevTouchMid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
        }
    }, { passive: false });

    canvasEl.addEventListener('touchmove', (event) => {
        event.preventDefault();
        _touchMoved = true;

        if (event.touches.length === 1 && _touchStartPos) {
            // Single finger pan
            let dx = event.touches[0].clientX - _touchStartPos.x;
            let dy = event.touches[0].clientY - _touchStartPos.y;
            mapOffsetX += dx; mapOffsetY += dy;
            _touchStartPos = { x: event.touches[0].clientX, y: event.touches[0].clientY };

        } else if (event.touches.length === 2) {
            // Two-finger pinch-to-zoom
            let t0 = event.touches[0], t1 = event.touches[1];
            let newDist = dist(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
            let newMid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };

            if (_prevTouchDist !== null && _prevTouchMid !== null) {
                let s = newDist / _prevTouchDist;
                let newScale = constrain(mapScale * s, minZoomScale, 5.0);
                let wx = (newMid.x - mapOffsetX) / mapScale;
                let wy = (newMid.y - mapOffsetY) / mapScale;
                mapOffsetX = newMid.x - wx * newScale;
                mapOffsetY = newMid.y - wy * newScale;
                mapScale = newScale;
                mapOffsetX += newMid.x - _prevTouchMid.x;
                mapOffsetY += newMid.y - _prevTouchMid.y;
            }
            _prevTouchDist = newDist;
            _prevTouchMid = newMid;
        }
    }, { passive: false });

    canvasEl.addEventListener('touchend', (event) => {
        event.preventDefault();
        if (!_touchMoved && event.changedTouches && event.changedTouches.length === 1) {
            // Tap = station selection
            let t = event.changedTouches[0];
            let rect = canvasEl.getBoundingClientRect();
            let cx = t.clientX - rect.left;
            let cy = t.clientY - rect.top;
            let mx = (cx - mapOffsetX) / mapScale;
            let my = (cy - mapOffsetY) / mapScale;

            let clickedStation = null;
            for (let s of stations) { if (dist(mx, my, s.x, s.y) < STATION_SIZE + 8) { clickedStation = s; break; } }
            if (!clickedStation) { for (let h of cachedHubs) { let w = STATION_SIZE + (h.stations.length * 4); if (dist(mx, my, h.x, h.y) < w / 1.5) { clickedStation = h.stations[0]; break; } } }

            if (clickedStation) {
                if (!selectedStart) { selectedStart = clickedStation; selectedEnd = null; currentPath = []; }
                else if (!selectedEnd) { selectedEnd = clickedStation; findPath(selectedStart, selectedEnd); }
                else { selectedStart = clickedStation; selectedEnd = null; currentPath = []; if (isJourneyActive) { stopJourney(false); resetMiniPlayer(); } renderMainGenres(); }
            } else {
                selectedStart = null; selectedEnd = null; currentPath = [];
                if (isJourneyActive) { stopJourney(false); resetMiniPlayer(); }
                renderMainGenres();
            }
        }
        _prevTouchDist = null;
        _prevTouchMid = null;
        if (event.touches.length === 1) {
            _touchStartPos = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        }
    }, { passive: false });
}

// --- JOURNEY LOGIC ---
function handleSelectionClick() {
    let mx = (mouseX - mapOffsetX) / mapScale; let my = (mouseY - mapOffsetY) / mapScale;
    let clickedStation = null;
    for (let s of stations) { if (dist(mx, my, s.x, s.y) < STATION_SIZE + 5) { clickedStation = s; break; } }
    if (!clickedStation) { for (let h of cachedHubs) { let w = STATION_SIZE + (h.stations.length * 4); if (dist(mx, my, h.x, h.y) < w / 1.5) { clickedStation = h.stations[0]; break; } } }

    if (clickedStation) {
        if (!selectedStart) { selectedStart = clickedStation; selectedEnd = null; currentPath = []; }
        else if (!selectedEnd) { selectedEnd = clickedStation; findPath(selectedStart, selectedEnd); }
        else { selectedStart = clickedStation; selectedEnd = null; currentPath = []; if (isJourneyActive) { stopJourney(false); resetMiniPlayer(); } renderMainGenres(); }
    } else {
        // Click on empty space: deselect stations but don't interrupt manual playback
        selectedStart = null; selectedEnd = null; currentPath = [];
        if (isJourneyActive) { stopJourney(false); resetMiniPlayer(); }
        renderMainGenres();
    }
}

function findPath(start, end) {
    let queue = [[start.station_id]]; let visited = new Set(); visited.add(start.station_id);
    while (queue.length > 0) {
        let path = queue.shift(); let lastId = path[path.length - 1];
        if (lastId === end.station_id) { currentPath = path.map(id => stations.find(s => s.station_id === id)); startMusicalJourney(); return; }
        let neighbors = adjacencyList[lastId] || [];
        for (let n of neighbors) { if (!visited.has(n)) { visited.add(n); queue.push([...path, n]); } }
    }
    alert("No connection found between these stations."); currentPath = [];
}

function renderJourneyItinerary() {
    let navContent = select('#navigation-content');
    navContent.html('');

    let backBtn = createDiv('← BACK').addClass('nav-item back-button').parent(navContent);
    onTap(backBtn.elt, () => { stopJourney(false); resetMiniPlayer(); selectedStart = null; selectedEnd = null; currentPath = []; renderMainGenres(); });

    let startStation = currentPath[0];
    let endStation = currentPath[currentPath.length - 1];
    let startLine = lines.find(l => l.line_id == startStation.line_id);
    let endLine = lines.find(l => l.line_id == endStation.line_id);

    let titleDiv = createDiv('').style('margin-bottom', '16px').style('font-size', '12px').style('opacity', '0.7').parent(navContent);
    let startSpan = createSpan(startStation.name).style('font-weight', 'bold').style('color', startLine ? startLine.color : '#fff').parent(titleDiv);
    createSpan(' → ').parent(titleDiv);
    createSpan(endStation.name).style('font-weight', 'bold').style('color', endLine ? endLine.color : '#fff').parent(titleDiv);

    let ul = createElement('ul').addClass('nav-list').attribute('id', 'journey-list').parent(navContent);

    let prevLineId = null;
    currentPath.forEach((station, idx) => {
        if (prevLineId !== null && station.line_id !== prevLineId) {
            let lineObj = lines.find(l => l.line_id == station.line_id);
            let sep = createElement('li').parent(ul);
            sep.style('padding', '5px 0 5px 29px').style('font-size', '10px').style('opacity', '0.55')
               .style('letter-spacing', '0.5px').style('animation', 'none');
            sep.elt.textContent = '↔ TRANSFER TO ' + (lineObj ? lineObj.name.toUpperCase() : '');
        }

        let li = createElement('li').addClass('nav-item').attribute('id', 'jstep-' + idx).parent(ul);
        li.style('animation', 'none').style('opacity', '1').style('transform', 'none')
          .style('padding', '8px 8px').style('border-radius', '6px').style('transition', 'background 0.2s, opacity 0.2s');

        let lineObj = lines.find(l => l.line_id == station.line_id);
        createElement('span').addClass('subgenre-dot').style('background', lineObj ? lineObj.color : '#fff').parent(li);
        createSpan(station.name).parent(li);

        prevLineId = station.line_id;
    });
}

function updateJourneyItinerary() {
    currentPath.forEach((_, idx) => {
        let el = select('#jstep-' + idx);
        if (!el) return;
        if (idx === currentStationIdx) {
            el.style('background', 'rgba(255,255,255,0.2)').style('opacity', '1');
        } else if (idx < currentStationIdx) {
            el.style('background', 'transparent').style('opacity', '0.35');
        } else {
            el.style('background', 'transparent').style('opacity', '1');
        }
    });
    // Scroll to current step
    let activeEl = select('#jstep-' + currentStationIdx);
    if (activeEl) activeEl.elt.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function startMusicalJourney() {
    stopJourney(true);
    if (currentPath.length === 0) return;
    isJourneyActive = true;
    currentStationIdx = 0;
    renderJourneyItinerary();
    playCurrentStep();
}

function playCurrentStep() {
    if (nextTimeout) clearTimeout(nextTimeout);
    if (currentStationIdx >= currentPath.length) { stopJourney(false); resetMiniPlayer(); renderMainGenres(); return; }

    let station = currentPath[currentStationIdx];
    let isHub = false; for (let h of cachedHubs) { if (h.stations.some(s => s.station_id === station.station_id)) { if (h.stations.length > 2) isHub = true; break; } }
    let stationStopTime = isHub ? 5000 : 2000;
    journeyTimer = millis(); trainPos = createVector(station.x, station.y);

    updateJourneyItinerary();

    if (station.playlist && station.playlist.length > 0) {
        let track = random(station.playlist);

        let lineObj = lines.find(l => l.line_id == station.line_id);
        updateMiniPlayer(track.title, track.artist, station.name, lineObj ? lineObj.color : '#fff');

        crossfadeToTrack(track.url);
        let stepDuration = STATION_DURATION + stationStopTime;
        stepEndTime = millis() + stepDuration;
        nextTimeout = setTimeout(() => { currentStationIdx++; playCurrentStep(); }, stepDuration);
    } else {
        let stepDuration = 2000 + stationStopTime;
        stepEndTime = millis() + stepDuration;
        nextTimeout = setTimeout(() => { currentStationIdx++; playCurrentStep(); }, stepDuration);
    }
}

function updateTrainPosition() {
    if (currentStationIdx >= currentPath.length - 1) {
        let finalS = currentPath[currentPath.length - 1];
        trainPos = createVector(finalS.x, finalS.y);
        return;
    }
    let startS = currentPath[currentStationIdx];
    let nextS = currentPath[currentStationIdx + 1];
    let elapsed = millis() - journeyTimer;
    let progress = constrain(elapsed / STATION_DURATION, 0, 1);
    // Follow the routed path (with bend waypoints) instead of a straight line
    let pts = insertWaypoints([startS, nextS]);
    trainPos = interpolateAlongPath(pts, progress);
}

function interpolateAlongPath(pts, t) {
    if (pts.length < 2) return createVector(pts[0].x, pts[0].y);
    let lengths = [];
    let totalLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        let d = dist(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        lengths.push(d);
        totalLen += d;
    }
    if (totalLen === 0) return createVector(pts[0].x, pts[0].y);
    let target = t * totalLen;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        if (acc + lengths[i] >= target) {
            let segT = lengths[i] === 0 ? 0 : (target - acc) / lengths[i];
            return createVector(lerp(pts[i].x, pts[i + 1].x, segT), lerp(pts[i].y, pts[i + 1].y, segT));
        }
        acc += lengths[i];
    }
    return createVector(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

// --- STOP JOURNEY ---
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
    if (playPromise !== undefined) { playPromise.then(() => { performFade(incoming, 0, 1); performFade(outgoing, outgoing.volume, 0); }).catch(error => { console.error(error); if (isJourneyActive) { if (nextTimeout) clearTimeout(nextTimeout); setTimeout(() => { currentStationIdx++; playCurrentStep(); }, 1000); } }); }
    activeDeck = (activeDeck === 'A') ? 'B' : 'A';
}
function performFade(player, startVol, endVol) {
    let steps = 20; let stepTime = CROSSFADE_DURATION / steps; let volStep = (endVol - startVol) / steps; let currentStep = 0;
    let interval = setInterval(() => { currentStep++; let newVol = Math.max(0, Math.min(1, startVol + (volStep * currentStep))); try { player.volume = newVol; } catch (e) { } if (currentStep >= steps) { clearInterval(interval); if (endVol === 0) { player.pause(); player.currentTime = 0; } } }, stepTime);
    activeIntervals.push(interval);
}
function fadeOut(player) { performFade(player, player.volume, 0); }
function killAllFades() { for (let i = 0; i < activeIntervals.length; i++) clearInterval(activeIntervals[i]); activeIntervals = []; }

// --- UTILS ---
function calculateInitialCameraFit() {
    if (stations.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let s of stations) {
        if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
        if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
    }
    let margin = GRID_SIZE * 2;
    let w = maxX - minX + margin * 2; let h = maxY - minY + margin * 2;
    minZoomScale = Math.min(width / w, height / h);
    minZoomScale = constrain(minZoomScale, 0.15, 1.0);
    mapScale = minZoomScale;
    let cx = (minX + maxX) / 2; let cy = (minY + maxY) / 2;
    mapOffsetX = width / 2 - cx * mapScale; mapOffsetY = height / 2 - cy * mapScale;

    mapBounds = { minX: minX, maxX: maxX, minY: minY, maxY: maxY };

    // Center and max distance for intro animation
    mapCenter = createVector(cx, cy);
    maxMapDistance = 0;
    for (let s of stations) {
        let d = dist(s.x, s.y, cx, cy);
        if (d > maxMapDistance) maxMapDistance = d;
    }
    maxMapDistance += GRID_SIZE * 2; // extra padding
    introStartTime = millis();
    introActive = true;
}

function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

function drawClippedPath(stations, radius, center, pass, isDimmed, lineObj) {
    if (!stations || stations.length < 2) return;

    strokeWeight(pass === 0 ? LINE_WIDTH + 2 : LINE_WIDTH);
    if (pass === 0) stroke(0, 0, 0, 15);
    else stroke(isDimmed ? color(220) : lineObj.color);

    let shapeOpen = false;

    function addV(x, y) {
        if (!shapeOpen) { beginShape(); shapeOpen = true; }
        if (pass === 0) vertex(x + 3, y + 3);
        else vertex(x, y);
    }
    function closeS() {
        if (shapeOpen) { endShape(); shapeOpen = false; }
    }

    for (let i = 0; i < stations.length - 1; i++) {
        let s1 = stations[i];
        let s2 = stations[i + 1];

        let d1 = dist(s1.x, s1.y, center.x, center.y);
        let d2 = dist(s2.x, s2.y, center.x, center.y);

        if (d1 <= radius && d2 <= radius) {
            if (!shapeOpen) addV(s1.x, s1.y);
            addV(s2.x, s2.y);
        }
        else if (d1 <= radius && d2 > radius) {
            if (!shapeOpen) addV(s1.x, s1.y);
            let t = (radius - d1) / (d2 - d1);
            let ix = lerp(s1.x, s2.x, t);
            let iy = lerp(s1.y, s2.y, t);
            addV(ix, iy);
            closeS();
        }
        else if (d1 > radius && d2 <= radius) {
            closeS();
            let t = (radius - d1) / (d2 - d1);
            let ix = lerp(s1.x, s2.x, t);
            let iy = lerp(s1.y, s2.y, t);
            addV(ix, iy);
            addV(s2.x, s2.y);
        }
        else {
            closeS();
        }
    }
    closeS();
}

// Insert waypoints for metro-map-style rendering:
// between two stations, route via a diagonal then a straight segment
// instead of a raw diagonal line.
function insertWaypoints(pts) {
    if (pts.length < 2) return pts;
    let result = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
        let a = pts[i - 1]; let b = pts[i];
        let dx = b.x - a.x; let dy = b.y - a.y;
        let adx = Math.abs(dx); let ady = Math.abs(dy);
        // Already axis-aligned (horizontal, vertical or 45° diagonal)
        if (adx === 0 || ady === 0 || Math.abs(adx - ady) < 2) {
            result.push(b);
            continue;
        }
        // Insert bend point: diagonal first, then straight
        let diag = Math.min(adx, ady);
        let wx = a.x + Math.sign(dx) * diag;
        let wy = a.y + Math.sign(dy) * diag;
        result.push({ x: wx, y: wy });
        result.push(b);
    }
    return result;
}

function drawGrid() {
    stroke(238); // Very subtle grid
    strokeWeight(1);

    // Visible bounds in world coordinates
    // Inverse transform: World = (Screen - Translate) / Scale
    let startX = -mapOffsetX / mapScale;
    let startY = -mapOffsetY / mapScale;
    let endX = (width - mapOffsetX) / mapScale;
    let endY = (height - mapOffsetY) / mapScale;

    let firstGridX = Math.floor(startX / GRID_SIZE) * GRID_SIZE;
    let firstGridY = Math.floor(startY / GRID_SIZE) * GRID_SIZE;
    let margin = GRID_SIZE;

    // Vertical lines
    for (let x = firstGridX - margin; x <= endX + margin; x += GRID_SIZE) {
        line(x, startY - margin, x, endY + margin);
    }
    // Horizontal lines
    for (let y = firstGridY - margin; y <= endY + margin; y += GRID_SIZE) {
        line(startX - margin, y, endX + margin, y);
    }
}

function getConnectedStationID(stationID, validLineIDs) { for (let t of transfers) { let neighbor = null; if (t.source === stationID) neighbor = t.target; if (t.target === stationID) neighbor = t.source; if (neighbor) { let neighborLine = getLineOfStation(neighbor, Object.values(metroData.stations)); if (validLineIDs.has(neighborLine)) return neighbor; } } return null; }
function getLineOfStation(sid, allStations) { let s = allStations.find(st => st.station_id === sid); return s ? s.line_id : null; }
function getLineID(sid, allS) { let f = allS.find(s => s.station_id === sid); return f ? f.line_id : null; }
function findFreeSpot(cx, cy) { let r = 0; while (r < 200) { for (let angle = 0; angle < TWO_PI; angle += 0.5) { let tx = cx + Math.round(Math.cos(angle) * r) * GRID_SIZE; let ty = cy + Math.round(Math.sin(angle) * r) * GRID_SIZE; if (!takenCells.has(makeKey(tx, ty))) return { x: tx, y: ty }; } r++; } return { x: cx, y: cy }; }
function markOccupied(x, y) { takenCells.add(makeKey(x, y)); }
function makeKey(x, y) { return x + "," + y; }
function isOccupiedByLine(x, y, lineId) { return takenCells.has(makeKey(x, y)); }
function myRandom() { return random(); }
function detectHubs() { let map = {}; let hubs = []; for (let s of stations) { if (s.x === undefined) continue; let k = Math.round(s.x) + "," + Math.round(s.y); if (!map[k]) map[k] = []; map[k].push(s); } for (let k in map) { if (map[k].length > 1) hubs.push({ x: map[k][0].x, y: map[k][0].y, stations: map[k] }); } return hubs; }
function isStationInHub(s, hubs) { for (let h of hubs) { if (dist(s.x, s.y, h.x, h.y) < 2) return true; } return false; }
function groupStationsByLine() { let g = {}; for (let s of stations) { if (s.x === undefined) continue; if (!g[s.line_id]) g[s.line_id] = []; g[s.line_id].push(s); } return g; }
function buildSpatialGraph() { adjacencyList = {}; for (let s of stations) adjacencyList[s.station_id] = []; let groups = groupStationsByLine(); for (let id in groups) { let arr = groups[id]; for (let i = 0; i < arr.length - 1; i++) { let u = arr[i]; let v = arr[i + 1]; adjacencyList[u.station_id].push(v.station_id); adjacencyList[v.station_id].push(u.station_id); } } for (let i = 0; i < stations.length; i++) { for (let j = i + 1; j < stations.length; j++) { let s1 = stations[i]; let s2 = stations[j]; if (s1.line_id === s2.line_id) continue; if (dist(s1.x, s1.y, s2.x, s2.y) < 5) { adjacencyList[s1.station_id].push(s2.station_id); adjacencyList[s2.station_id].push(s1.station_id); } } } }
function generateOptimizedLayout(seed) { randomSeed(seed); takenCells.clear(); let rawLines = Object.values(metroData.lines); let rawStations = Object.values(metroData.stations); if (metroData.transfers) transfers = metroData.transfers; let connectivity = {}; rawLines.forEach(l => connectivity[l.line_id] = 0); transfers.forEach(t => { let l1 = getLineID(t.source, rawStations); let l2 = getLineID(t.target, rawStations); if (l1 && l2 && l1 !== l2) { connectivity[l1]++; connectivity[l2]++; } }); rawLines.sort((a, b) => connectivity[b.line_id] - connectivity[a.line_id]); let placedLines = new Set(); let angleStep = TWO_PI / Math.max(1, rawLines.length); for (let i = 0; i < rawLines.length; i++) { let lineData = rawLines[i]; let lineStations = rawStations.filter(s => s.line_id === lineData.line_id); if (lineStations.length === 0) continue; lineStations.sort((a, b) => a.station_id - b.station_id); let anchor = null; let bestAnchorConn = -1; for (let s of lineStations) { for (let t of transfers) { let nb = null; if (t.source === s.station_id) nb = t.target; else if (t.target === s.station_id) nb = t.source; if (nb !== null) { let nbLine = getLineID(nb, rawStations); if (nbLine && placedLines.has(nbLine) && connectivity[nbLine] > bestAnchorConn) { let targetS = stationMap[nb]; if (targetS) { bestAnchorConn = connectivity[nbLine]; anchor = { myStation: s, targetX: targetS.x, targetY: targetS.y }; } } } } } let sectorAngle = i * angleStep; let preferredDirIdx = getBestDirIndexFromAngle(sectorAngle); lineDirectionMap[lineData.line_id] = preferredDirIdx; if (anchor) { anchor.myStation.x = anchor.targetX; anchor.myStation.y = anchor.targetY; markOccupied(anchor.targetX, anchor.targetY); } else { let startRadius = GRID_SIZE * 3; let startX = Math.round((Math.cos(sectorAngle) * startRadius) / GRID_SIZE) * GRID_SIZE; let startY = Math.round((Math.sin(sectorAngle) * startRadius) / GRID_SIZE) * GRID_SIZE; let spot = findFreeSpot(startX, startY); let midIdx = Math.floor(lineStations.length / 2); if (lineStations[midIdx]) { lineStations[midIdx].x = spot.x; lineStations[midIdx].y = spot.y; markOccupied(spot.x, spot.y); } } let placedIndices = lineStations.map((s, idx) => (s.x !== undefined ? idx : -1)).filter(idx => idx !== -1); if (placedIndices.length === 0 && lineStations.length > 0) { let backupX = Math.round((Math.cos(sectorAngle) * GRID_SIZE * 4) / GRID_SIZE) * GRID_SIZE; let backupY = Math.round((Math.sin(sectorAngle) * GRID_SIZE * 4) / GRID_SIZE) * GRID_SIZE; lineStations[0].x = backupX; lineStations[0].y = backupY; markOccupied(backupX, backupY); placedIndices.push(0); } if (placedIndices.length > 0) { let momentum = { lastDirIdx: preferredDirIdx, streak: 0 }; for (let j = placedIndices[0] - 1; j >= 0; j--) { placeNextStation(lineStations[j + 1], lineStations[j], preferredDirIdx, momentum); } momentum.lastDirIdx = preferredDirIdx; momentum.streak = 0; for (let j = placedIndices[placedIndices.length - 1] + 1; j < lineStations.length; j++) { placeNextStation(lineStations[j - 1], lineStations[j], preferredDirIdx, momentum); } } lines.push(lineData); lineStations.forEach(s => { s.lineColor = lineData.color; stationMap[s.station_id] = s; stations.push(s); }); placedLines.add(lineData.line_id); } }
function placeNextStation(prevS, currentS, preferredDirIdx, momentum) {
    if (prevS.x === undefined || prevS.y === undefined) return;
    let lastDir = (momentum && momentum.lastDirIdx >= 0) ? momentum.lastDirIdx : preferredDirIdx;
    // Decaying momentum: strong at first, weakens after straight steps
    // to allow natural turns (Paris metro look)
    let streak = (momentum && momentum.streak >= 0) ? momentum.streak : 0;
    // Forcer un virage après MAX_STRAIGHT stations consécutives
    const MAX_STRAIGHT = 2;
    let forceTurn = streak >= MAX_STRAIGHT;

    let candidates = [];
    for (let dIndex = 0; dIndex < DIRS.length; dIndex++) {
        let dir = DIRS[dIndex];
        let tx = prevS.x + dir.x * GRID_SIZE;
        let ty = prevS.y + dir.y * GRID_SIZE;
        if (!isOccupiedByLine(tx, ty, currentS.line_id)) {
            // Forced turn: exclude current direction
            if (forceTurn && dIndex === lastDir) continue;

            let score = random() * 0.3;
            // Momentum bonus (only if no forced turn)
            if (!forceTurn && dIndex === lastDir) score += 4.0;
            // Preferred line direction
            if (dIndex === preferredDirIdx) score += 1.5;
            // Penalize U-turns
            let da = DIRS[dIndex], db = DIRS[lastDir];
            let lenA = Math.sqrt(da.x * da.x + da.y * da.y);
            let lenB = Math.sqrt(db.x * db.x + db.y * db.y);
            let dot = (da.x / lenA) * (db.x / lenB) + (da.y / lenA) * (db.y / lenB);
            if (dot < -0.5) score -= 10.0;
            candidates.push({ x: tx, y: ty, score: score, dirIdx: dIndex });
        }
    }
    if (candidates.length === 0) {
        let jumpDir = DIRS[preferredDirIdx];
        let spot = findFreeSpot(prevS.x + jumpDir.x * GRID_SIZE * 2, prevS.y + jumpDir.y * GRID_SIZE * 2);
        currentS.x = spot.x; currentS.y = spot.y;
        if (momentum) { momentum.lastDirIdx = preferredDirIdx; momentum.streak = 0; }
    } else {
        candidates.sort((a, b) => b.score - a.score);
        currentS.x = candidates[0].x; currentS.y = candidates[0].y;
        if (momentum) {
            if (candidates[0].dirIdx === lastDir) {
                momentum.streak = streak + 1;
            } else {
                momentum.streak = 0;
            }
            momentum.lastDirIdx = candidates[0].dirIdx;
        }
    }
    markOccupied(currentS.x, currentS.y);
}
function applySecondaryColocations() {
    // Connectivity per line (to decide which station moves to which)
    let lineConn = {};
    for (let l of lines) lineConn[l.line_id] = 0;
    for (let t of transfers) {
        let l1 = stationMap[t.source] ? stationMap[t.source].line_id : null;
        let l2 = stationMap[t.target] ? stationMap[t.target].line_id : null;
        if (l1 && l2 && l1 !== l2) { lineConn[l1] = (lineConn[l1] || 0) + 1; lineConn[l2] = (lineConn[l2] || 0) + 1; }
    }

    let sorted = [...transfers].sort((a, b) => (b.strength || 0) - (a.strength || 0));
    let movedStations = new Set();
    let movedLines = new Set(); // at most one station moved per line
    let linesWithHub = new Set(); // lines that have at least one hub

    function applyColocation(s1, s2) {
        if (!s1 || !s2 || s1.x === undefined || s2.x === undefined) return false;
        if (dist(s1.x, s1.y, s2.x, s2.y) < 5) {
            linesWithHub.add(s1.line_id); linesWithHub.add(s2.line_id); return true;
        }
        let host = (lineConn[s1.line_id] || 0) >= (lineConn[s2.line_id] || 0) ? s1 : s2;
        let guest = host === s1 ? s2 : s1;
        if (movedStations.has(guest.station_id)) return false;
        guest.x = host.x; guest.y = host.y;
        movedStations.add(guest.station_id);
        movedLines.add(guest.line_id);
        linesWithHub.add(guest.line_id);
        linesWithHub.add(host.line_id);
        return true;
    }

    // Pass 1: top-50 transfers (one station moved per line max)
    for (let t of sorted.slice(0, 50)) {
        let s1 = stationMap[t.source]; let s2 = stationMap[t.target];
        if (!s1 || !s2 || s1.line_id === s2.line_id) continue;
        if (movedLines.has(s1.line_id) || movedLines.has(s2.line_id)) {
            // Même si la ligne a déjà bougé, marquer les deux côtés comme connectés si déjà co-localisés
            if (s1.x !== undefined && s2.x !== undefined && dist(s1.x, s1.y, s2.x, s2.y) < 5) {
                linesWithHub.add(s1.line_id); linesWithHub.add(s2.line_id);
            }
            continue;
        }
        applyColocation(s1, s2);
    }

    // Pass 2: still-isolated lines → force their best transfer toward the connected network
    let changed = true;
    while (changed) {
        changed = false;
        for (let l of lines) {
            if (linesWithHub.has(l.line_id)) continue;
            let lineStationIds = new Set(stations.filter(s => s.line_id === l.line_id).map(s => s.station_id));
            // Chercher d'abord un transfert vers une ligne déjà connectée
            let best = null;
            for (let t of sorted) {
                let has1 = lineStationIds.has(t.source); let has2 = lineStationIds.has(t.target);
                if (!(has1 || has2) || (has1 && has2)) continue;
                let otherLine = has1 ? stationMap[t.target]?.line_id : stationMap[t.source]?.line_id;
                if (linesWithHub.has(otherLine)) { best = t; break; }
                if (!best) best = t; // fallback: any transfer
            }
            if (!best) continue;
            let s1 = stationMap[best.source]; let s2 = stationMap[best.target];
            if (applyColocation(s1, s2)) changed = true;
        }
    }
}

function applyParallelLineAdjustment() { if (!transfers || transfers.length === 0) return; let pairCounts = {}; for (let t of transfers) { let s1 = stationMap[t.source]; let s2 = stationMap[t.target]; if (!s1 || !s2) continue; let l1 = String(s1.line_id); let l2 = String(s2.line_id); if (l1 === l2) continue; let key = l1 < l2 ? l1 + "-" + l2 : l2 + "-" + l1; pairCounts[key] = (pairCounts[key] || 0) + 1; } let keys = Object.keys(pairCounts).sort((a, b) => pairCounts[b] - pairCounts[a]); let alreadyAdjusted = new Set(); for (let key of keys) { if (pairCounts[key] < 4) break; let [lA, lB] = key.split("-"); if (alreadyAdjusted.has(lA) || alreadyAdjusted.has(lB)) continue; makeLinesParallel(lA, lB); alreadyAdjusted.add(lA); alreadyAdjusted.add(lB); } }
function makeLinesParallel(lineAId, lineBId) { lineAId = String(lineAId); lineBId = String(lineBId); let lineAStations = stations.filter(s => String(s.line_id) === lineAId && s.x !== undefined).sort((a, b) => a.station_id - b.station_id); let lineBStations = stations.filter(s => String(s.line_id) === lineBId && s.x !== undefined).sort((a, b) => a.station_id - b.station_id); if (lineAStations.length < 2 || lineBStations.length < 2) return; let anchorA = null, anchorB = null; for (let t of transfers) { let s1 = stationMap[t.source]; let s2 = stationMap[t.target]; if (!s1 || !s2) continue; let l1 = String(s1.line_id); let l2 = String(s2.line_id); if ((l1 === lineAId && l2 === lineBId) || (l1 === lineBId && l2 === lineAId)) { if (l1 === lineAId) { anchorA = s1; anchorB = s2; } else { anchorA = s2; anchorB = s1; } break; } } if (!anchorA || !anchorB) return; let idxA = lineAStations.findIndex(s => s.station_id === anchorA.station_id); if (idxA === -1) return; let dir = { x: 0, y: 0 }; if (idxA > 0) { dir.x += anchorA.x - lineAStations[idxA - 1].x; dir.y += anchorA.y - lineAStations[idxA - 1].y; } if (idxA < lineAStations.length - 1) { dir.x += lineAStations[idxA + 1].x - anchorA.x; dir.y += lineAStations[idxA + 1].y - anchorA.y; } let len = Math.sqrt(dir.x * dir.x + dir.y * dir.y); if (!len) { dir.x = 1; len = 1; } dir.x /= len; dir.y /= len; let perp = { x: -dir.y, y: dir.x }; let offset = LINE_WIDTH * 1.5; let n = Math.min(lineAStations.length, lineBStations.length); for (let i = 0; i < n; i++) { let sA = lineAStations[i]; let sB = lineBStations[i]; if (sB.station_id === anchorB.station_id) { sB.x = sA.x; sB.y = sA.y; } else { sB.x = sA.x + perp.x * offset; sB.y = sA.y + perp.y * offset; } } }
function getBestDirIndexFromAngle(angle) { let maxDot = -Infinity; let bestIdx = 0; let cx = Math.cos(angle); let cy = Math.sin(angle); for (let i = 0; i < DIRS.length; i++) { let d = DIRS[i]; let len = Math.sqrt(d.x * d.x + d.y * d.y); let dx = d.x / len; let dy = d.y / len; let dot = dx * cx + dy * cy; if (dot > maxDot) { maxDot = dot; bestIdx = i; } } return bestIdx; }
function calculateLabelAngle(s) { let defaultAngle = -PI / 4; let checkX = s.x + GRID_SIZE; let checkY = s.y - GRID_SIZE; if (takenCells.has(makeKey(checkX, checkY))) return PI / 4; return defaultAngle; }
function drawAngledLabel(s, isHub, angle) { push(); translate(s.x, s.y); let d = isHub ? 20 : 12; rotate(angle); textAlign(LEFT, CENTER); textSize(11); textStyle(NORMAL); stroke(255, 255, 255, 200); strokeWeight(3.5); noFill(); text(s.name, d, 0); noStroke(); fill(20); text(s.name, d, 0); pop(); }
function drawHubLabel(hub, angle) { push(); translate(hub.x, hub.y); rotate(angle); textAlign(LEFT, CENTER); let lineH = 12; let total = hub.stations.length; let startY = -((total - 1) * lineH) / 2; hub.stations.forEach((s, i) => { let lineObj = lines.find(l => l.line_id == s.line_id); let col = lineObj ? color(lineObj.color) : color(0); textSize(10); textStyle(BOLD); stroke(255, 255, 255, 210); strokeWeight(3); noFill(); text(s.name, 22, startY + i * lineH); noStroke(); fill(col); text(s.name, 22, startY + i * lineH); }); pop(); }