
const firebaseConfig = {
    apiKey: "AIzaSyAJt51st7wQbFL9Icp13dANmIfy26aUMQ0",
    authDomain: "infinity-cafe-d56e6.firebaseapp.com",
    databaseURL: "https://infinity-cafe-d56e6-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "infinity-cafe-d56e6",
    storageBucket: "infinity-cafe-d56e6.firebasestorage.app",
    messagingSenderId: "622305500620",
    appId: "1:622305500620:web:e9bbd77222e9a593315169",
    measurementId: "G-XK6TE427RL"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
} else {
    firebase.app(); 
}
const db = firebase.database();

const MY_NUMBER = "9137438842";
const HOURLY_RATE = 60;
const OWNER_KEY = "1234";

// PHASE 1: GENERATE SLOTS
const TIMES = [];
for (let h = 14; h <= 23; h++) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12; 
    const hourStr = h12 < 10 ? '0' + h12 : h12;
    TIMES.push(`${hourStr}:00 ${ampm}`);
    if (h !== 24) TIMES.push(`${hourStr}:30 ${ampm}`);
}

let pcs = Array.from({length: 10}, (_, i) => ({ id: i + 1, slots: [] }));
let pendingRequests = [];
let totalRevenue = 0;
let announcement = "";
let isLocked = false;

let selectionState = { primaryPc: null, squadIds: [], start: null, end: null, mode: 'USER' };
let adminSquadIds = [];

window.addEventListener('load', () => {
    db.ref('/').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            pcs = data.pcs || Array.from({length: 10}, (_, i) => ({ id: i + 1, slots: [] }));
            pendingRequests = data.pendingRequests || [];
            totalRevenue = data.totalRevenue || 0;
            announcement = data.announcement || "";
            isLocked = data.isLocked || false;
        }
        checkLockdown();
        checkAnnouncement();
        render();
        if(document.getElementById('adminSection').style.display === 'flex') {
            renderAdmin();
        }
        document.getElementById('loader').style.display = 'none';
        document.body.classList.remove('loading');
    });
});

function updateCloud() {
    db.ref('/').update({
        pcs: pcs,
        pendingRequests: pendingRequests,
        totalRevenue: totalRevenue,
        announcement: announcement,
        isLocked: isLocked
    });
}


function parseTime(timeStr) {
    if (timeStr.includes('M')) {
        const [t, modifier] = timeStr.split(' ');
        let [h, m] = t.split(':').map(Number);
        if (modifier === 'PM' && h !== 12) h += 12;
        if (modifier === 'AM' && h === 12) h = 0;
        return h * 60 + m;
    } else {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }
}
function minsToTime(m) {
    const h = Math.floor(m / 60); const min = m % 60; const ampm = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12;
    return `${h12 < 10 ? '0' + h12 : h12}:${min < 10 ? '0' + min : min} ${ampm}`;
}
function minsToInputVal(m) { const h = Math.floor(m / 60); const min = m % 60; return `${h < 10 ? '0'+h : h}:${min < 10 ? '0'+min : min}`; }

function render() {
    const r1 = document.getElementById('row1'); const r2 = document.getElementById('row2'); 
    r1.innerHTML = ''; r2.innerHTML = '';
    let active = 0;

    pcs.forEach(pc => {
        if (!pc.slots) pc.slots = [];
        const currentSlot = getCurrentSlot(pc.slots);
        const busy = !!currentSlot;
        if (busy) active++;
        
        const card = document.createElement('div');
        card.className = `station-node ${busy ? 'node-busy' : 'node-ready'}`;
        
        let statusText = 'VACANT';
        let statusColor = '#888';
        if (busy) {
            const startMins = parseTime(currentSlot.startRaw);
            const endMins = startMins + currentSlot.duration;
            statusText = `BUSY UNTIL <span style="color:#fff">${minsToTime(endMins)}</span>`;
            statusColor = 'var(--neon-danger)';
        }

        card.innerHTML = `
            <div class="node-header"><span>PC ${pc.id}</span></div>
            <div class="node-main"><div class="status-text" style="color:${statusColor}">${statusText}</div></div>
            <div class="timeline-container">
                <div class="timeline-label"><span>02PM</span><span>SCHEDULE</span><span>11PM</span></div>
                <div class="timeline-track">${generateTimelineVisual(pc.slots)}</div>
            </div>
            <div class="action-group">
                <button class="node-action-btn" onclick="openBooking(${pc.id}, 'USER')">BOOK</button>
                <button class="node-action-btn view-schedule" onclick="openSchedule(${pc.id})">LOG</button>
                <button class="flash-btn" onclick="openBooking(${pc.id}, 'ADMIN')">⚡</button>
            </div>
        `;
        if (pc.id <= 5) r1.appendChild(card); else r2.appendChild(card);
    });
    updateStats(active);
}

function generateTimelineVisual(slots) {
    if(!slots) return '';
    let html = ''; const nowMins = getNowMins();
    TIMES.forEach(time => {
        const tMins = parseTime(time); let status = 'free';
        if (tMins < nowMins - 30) status = 'past';
        else if (slots.some(s => {
            const sStart = parseTime(s.startRaw); const sEnd = sStart + s.duration;
            return tMins >= sStart && tMins < sEnd;
        })) status = 'booked';
        html += `<div class="t-seg ${status}" title="${time}"></div>`;
    });
    return html;
}

function openBooking(id, mode) {
    if (mode === 'ADMIN') {
        const key = prompt("ENTER FLASH KEY:");
        if (key !== OWNER_KEY) return alert("ACCESS DENIED");
        document.getElementById('bookingPanel').classList.add('admin-mode');
        document.getElementById('bookingTitle').innerText = "ADMIN OVERRIDE";
        document.getElementById('actionBtn').innerText = "CONFIRM WALK-IN";
    } else {
        if(isLocked) return alert("CAFE LOCKED");
        document.getElementById('bookingPanel').classList.remove('admin-mode');
        document.getElementById('bookingTitle').innerText = "SQUAD DEPLOYMENT";
        document.getElementById('actionBtn').innerText = "SEND REQUEST";
    }
    selectionState = { primaryPc: id, squadIds: [id], start: null, end: null, mode: mode };
    document.getElementById('targetPcDisplay').innerText = `LEADER: PC ${id}`;
    renderSquadSelector(id);
    renderTimeGrid();
    document.getElementById('userBookingModal').style.display = 'flex';
}

function executeBookingAction() {
    if (selectionState.mode === 'ADMIN') confirmWalkIn();
    else sendRequestToCloud(); 
}

function confirmWalkIn() {
    const name = prompt("CUSTOMER NAME:") || "WALK-IN";
    if(!selectionState.start || !selectionState.end) return alert("SELECT TIMES");
    const startMins = parseTime(selectionState.start);
    const endMins = parseTime(selectionState.end);
    const duration = endMins - startMins;

    selectionState.squadIds.forEach(id => {
        if(!pcs[id-1].slots) pcs[id-1].slots = [];
        pcs[id - 1].slots.push({ name: name, startRaw: selectionState.start, duration: duration });
    });
    totalRevenue += (duration / 60) * HOURLY_RATE * selectionState.squadIds.length;
    
    updateCloud(); 
    closeUserModal();
}

function sendRequestToCloud() {
    const name = prompt("YOUR NAME:");
    if(!name || !selectionState.start || !selectionState.end) return alert("DATA MISSING");

    const msg = `🚀 NEW REQUEST: ${name} wants ${selectionState.squadIds.length} PCs | ${selectionState.start} to ${selectionState.end}`;
    window.open(`https://wa.me/91${MY_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');

    const startMins = parseTime(selectionState.start);
    const endMins = parseTime(selectionState.end);
    const duration = endMins - startMins;
    
    const newReq = { 
        pcIds: [...selectionState.squadIds], 
        playerName: name, 
        startTime: selectionState.start, 
        endTime: selectionState.end, 
        duration: duration, 
        id: Date.now() 
    };

    pendingRequests.push(newReq);
    updateCloud(); 
    
    alert("REQUEST SENT! CHECK WHATSAPP.");
    closeUserModal();
}

// --- ADMIN FEATURES ---
function setAnnouncement() {
    const text = document.getElementById('announceInput').value;
    if(!text) return;
    announcement = text;
    updateCloud();
}
function clearAnnouncement() {
    announcement = "";
    document.getElementById('announceInput').value = "";
    updateCloud();
}
function checkAnnouncement() {
    const bar = document.getElementById('newsTickerBar');
    const txt = document.getElementById('tickerText');
    if(announcement) { bar.style.display = 'block'; txt.innerText = announcement; } 
    else { bar.style.display = 'none'; }
}

function toggleLockdown() {
    isLocked = !isLocked;
    updateCloud();
    closeAdmin();
}
function checkLockdown() {
    const screen = document.getElementById('lockdownScreen');
    if(isLocked) screen.classList.add('lockdown-active');
    else screen.classList.remove('lockdown-active');
}

function adminManualBook() {
    const name = document.getElementById('manName').value;
    const startStr = document.getElementById('manStart').value;
    const endStr = document.getElementById('manEnd').value;
    
    if (!name || adminSquadIds.length === 0 || !startStr || !endStr) return alert("FILL ALL FIELDS");
    const startMins = parseTime(startStr);
    const endMins = parseTime(endStr);
    if (endMins <= startMins) return alert("CHECK TIMES");

    const collision = adminSquadIds.some(pcId => {
        if(!pcs[pcId-1].slots) pcs[pcId-1].slots = [];
        return pcs[pcId - 1].slots.some(s => {
            const sStart = parseTime(s.startRaw);
            const sEnd = sStart + s.duration;
            return (startMins < sEnd && endMins > sStart);
        });
    });

    if (collision) return alert("ONE OR MORE PCS ARE BOOKED");

    adminSquadIds.forEach(id => {
        if(!pcs[id-1].slots) pcs[id-1].slots = [];
        pcs[id - 1].slots.push({
            name: name,
            startRaw: startStr,
            duration: endMins - startMins
        });
    });

    totalRevenue += ((endMins - startMins) / 60) * HOURLY_RATE * adminSquadIds.length;
    updateCloud();
    adminSquadIds = []; 
    renderAdminSquadSelector();
    alert("DEPLOYED");
}

function renderAdminSquadSelector() {
    const grid = document.getElementById('adminSquadGrid');
    grid.innerHTML = pcs.map(pc => `
        <button class="squad-pill ${adminSquadIds.includes(pc.id) ? 'active' : ''}" 
        onclick="toggleAdminSquadMember(${pc.id})">PC ${pc.id}</button>
    `).join('');
}
function toggleAdminSquadMember(id) {
    if(adminSquadIds.includes(id)) adminSquadIds = adminSquadIds.filter(x => x !== id);
    else adminSquadIds.push(id);
    renderAdminSquadSelector();
}

function deleteSlot(pcId, slotIndex) {
    if(confirm("DELETE BOOKING?")) {
        pcs[pcId - 1].slots.splice(slotIndex, 1);
        updateCloud();
    }
}
function editSlot(pcId, slotIndex) {
    const slot = pcs[pcId - 1].slots[slotIndex];
    const startMins = parseTime(slot.startRaw);
    const endMins = startMins + slot.duration;
    document.getElementById('manName').value = slot.name;
    document.getElementById('manStart').value = minsToInputVal(startMins);
    document.getElementById('manEnd').value = minsToInputVal(endMins);
    adminSquadIds = [pcId]; renderAdminSquadSelector();
    pcs[pcId - 1].slots.splice(slotIndex, 1);
    updateCloud();
    alert("SLOT REMOVED. EDIT & DEPLOY TO SAVE.");
}

function renderAdmin() {
    renderAdminSquadSelector();
    const pendingDiv = document.getElementById('adminControls');
    const activeDiv = document.getElementById('activeSlotsList');

    let html = '';
    if(pendingRequests.length === 0) html = `<div style="text-align:center; color:#555; padding:10px;">NO REQUESTS</div>`;
    else {
        pendingRequests.forEach(req => {
            const cost = (req.duration / 60) * HOURLY_RATE * req.pcIds.length;
            html += `
                <div class="admin-strip">
                    <div><strong style="color:var(--neon-cyan)">${req.playerName}</strong><br>PC: ${req.pcIds.join(',')} | ${req.startTime} - ${req.endTime}</div>
                    <div style="text-align:right"><div>₹${cost.toFixed(0)}</div><button onclick="approveRequest(${req.id})" class="adm-btn add">ACCEPT</button><button onclick="rejectRequest(${req.id})" class="adm-btn wipe">DENY</button></div>
                </div>`;
        });
    }
    pendingDiv.innerHTML = html;

    let activeHtml = ''; let hasActive = false;
    pcs.forEach(pc => {
        if(pc.slots) {
            pc.slots.forEach((slot, idx) => {
                hasActive = true;
                const endMins = parseTime(slot.startRaw) + slot.duration;
                activeHtml += `
                    <div class="active-slot-item">
                        <div><strong>PC ${pc.id}</strong> - ${slot.name} <br> <span style="color:#888">${slot.startRaw} TO ${minsToTime(endMins)}</span></div>
                        <div class="slot-actions"><button onclick="editSlot(${pc.id}, ${idx})" class="slot-btn edit">EDIT</button><button onclick="deleteSlot(${pc.id}, ${idx})" class="slot-btn del">X</button></div>
                    </div>`;
            });
        }
    });
    if (!hasActive) activeHtml = `<div style="text-align:center; color:#555; padding:10px;">NO ACTIVE SESSIONS</div>`;
    activeDiv.innerHTML = activeHtml;
}

function approveRequest(reqId) {
    const idx = pendingRequests.findIndex(r => r.id === reqId);
    if(idx === -1) return;
    const req = pendingRequests[idx];
    req.pcIds.forEach(id => { 
        if(!pcs[id-1].slots) pcs[id-1].slots = [];
        pcs[id - 1].slots.push({ name: req.playerName, startRaw: req.startTime, duration: req.duration }); 
    });
    totalRevenue += (req.duration / 60) * HOURLY_RATE * req.pcIds.length;
    pendingRequests.splice(idx, 1);
    updateCloud();
}
function rejectRequest(reqId) {
    const idx = pendingRequests.findIndex(r => r.id === reqId);
    if(idx !== -1) pendingRequests.splice(idx, 1);
    updateCloud();
}
function getCurrentSlot(slots) {
    if(!slots) return null;
    const now = getNowMins();
    return slots.find(s => {
        const start = parseTime(s.startRaw);
        return now >= start && now < (start + s.duration);
    });
}
function getNowMins() { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); }
function updateStats(active) { document.getElementById('revenueVal').innerText = `₹${totalRevenue.toFixed(0)}`; document.getElementById('activeCount').innerText = active; }
function toggleAdmin() { if(prompt("KEY:") === OWNER_KEY) { document.getElementById('adminSection').style.display = 'flex'; renderAdmin(); }}
function clearAllData() { if(confirm("WIPE SYSTEM?")) { pcs = Array.from({length: 10}, (_, i) => ({ id: i + 1, slots: [] })); pendingRequests=[]; totalRevenue=0; updateCloud(); closeAdmin(); }}
function closeUserModal() { document.getElementById('userBookingModal').style.display = 'none'; }
function closeAdmin() { document.getElementById('adminSection').style.display = 'none'; }
function closeSchedule() { document.getElementById('scheduleModal').style.display = 'none'; }

function renderSquadSelector(leaderId) {
    const grid = document.getElementById('squadGrid');
    const available = pcs.filter(p => p.id !== leaderId && !getCurrentSlot(p.slots));
    grid.innerHTML = available.map(pc => `<button class="squad-pill" id="sq-${pc.id}" onclick="toggleSquadMember(${pc.id})">PC ${pc.id}</button>`).join('');
}
function toggleSquadMember(id) {
    const btn = document.getElementById(`sq-${id}`);
    if (selectionState.squadIds.includes(id)) { selectionState.squadIds = selectionState.squadIds.filter(x => x !== id); btn.classList.remove('active'); }
    else { selectionState.squadIds.push(id); btn.classList.add('active'); }
    renderTimeGrid();
}
function renderTimeGrid() {
    const grid = document.getElementById('slotGrid');
    grid.innerHTML = TIMES.map(time => {
        const tMins = parseTime(time);
        const btnId = `btn-${time.replace(/\s/g, '')}`;
        const isBlocked = selectionState.squadIds.some(pcId => {
            if(!pcs[pcId-1].slots) pcs[pcId-1].slots = [];
            return pcs[pcId - 1].slots.some(s => {
                const sStart = parseTime(s.startRaw); const sEnd = sStart + s.duration;
                return (tMins >= sStart && tMins < sEnd);
            });
        });
        return `<button class="slot-pill ${isBlocked ? 'taken' : ''}" id="${btnId}" ${isBlocked ? 'disabled' : ''} onclick="handleTimeClick('${time}')">${time}</button>`;
    }).join('');
}
function handleTimeClick(time) {
    const btnId = `btn-${time.replace(/\s/g, '')}`;
    const btn = document.getElementById(btnId);
    const activeColor = selectionState.mode === 'ADMIN' ? 'var(--neon-gold)' : 'var(--neon-cyan)';
    if (!selectionState.start) { selectionState.start = time; btn.style.background = activeColor; btn.style.color = "#000"; }
    else if (!selectionState.end) {
        if (parseTime(time) <= parseTime(selectionState.start)) return alert("INVALID TIME");
        const sMins = parseTime(selectionState.start); const eMins = parseTime(time);
        const collision = selectionState.squadIds.some(pcId => {
            if(!pcs[pcId-1].slots) pcs[pcId-1].slots = [];
            return pcs[pcId-1].slots.some(s => { const sStart = parseTime(s.startRaw); const sEnd = sStart + s.duration; return (sMins < sEnd && eMins > sStart); })
        });
        if (collision) return alert("SLOT BLOCKED");
        selectionState.end = time; btn.style.background = "var(--neon-danger)"; btn.style.color = "#fff"; highlightRange(sMins, eMins, activeColor);
    } else { selectionState.start = time; selectionState.end = null; renderTimeGrid(); const newBtn = document.getElementById(btnId); if(newBtn) { newBtn.style.background = activeColor; newBtn.style.color = "#000"; } }
}
function highlightRange(start, end, color) {
    TIMES.forEach(t => {
        const tMins = parseTime(t);
        if (tMins > start && tMins < end) { const b = document.getElementById(`btn-${t.replace(/\s/g, '')}`); if(b) b.style.background = "rgba(255,255,255,0.1)"; }
    });
}
function openSchedule(id) {
    const pc = pcs[id - 1]; document.getElementById('scheduleTitle').innerText = `PC ${id} SCHEDULE`; const list = document.getElementById('scheduleList');
    const sortedSlots = [...(pc.slots || [])].sort((a, b) => parseTime(a.startRaw) - parseTime(b.startRaw));
    if (sortedSlots.length === 0) { list.innerHTML = `<div class="schedule-empty">NO BOOKINGS</div>`; }
    else { list.innerHTML = sortedSlots.map(s => { const endMins = parseTime(s.startRaw) + s.duration; return `<div class="schedule-item booked"><div><strong>${s.startRaw} - ${minsToTime(endMins)}</strong><span>PLAYER: ${s.name}</span></div></div>`; }).join(''); }
    document.getElementById('scheduleModal').style.display = 'flex';
}

/* --- TIME SYNC FIX --- */
function tick() {
    render(); 
    document.getElementById('liveClock').innerText = new Date().toLocaleTimeString([], {
        hour: '2-digit', 
        minute:'2-digit'
    });
}

// RUN IMMEDIATELY & THEN EVERY MINUTE
tick();
setInterval(tick, 60000);
