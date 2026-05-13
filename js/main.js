document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('servicesGrid');
    const searchInput = document.getElementById('searchInput');
    const refreshBtn = document.getElementById('refreshBtn');
    const chips = document.querySelectorAll('.chip');

    // Fallback list used before the API responds
    const staticServices = [
        { name: "prometheus", container_name: "prometheus", ports: ["9091"], running: false },
        { name: "grafana", container_name: "grafana", ports: ["3001"], running: false },
        { name: "jaeger", container_name: "jaeger", ports: ["16686"], running: false },
        { name: "cadvisor", container_name: "cadvisor", ports: ["8080"], running: false },
        { name: "blackbox-exporter", container_name: "blackbox-exporter", ports: ["9115"], running: false },
        { name: "qdrant", container_name: "qdrant", ports: ["6333"], running: false },
        { name: "searxng", container_name: "searxng", ports: ["8081"], running: false },
        { name: "comfyui", container_name: "comfyui", ports: ["8188"], running: false },
        { name: "open-webui", container_name: "open-webui", ports: ["3000"], running: false },
        { name: "ai-gateway", container_name: "ai-gateway", ports: ["8088"], running: false },
        { name: "paperless", container_name: "paperless", ports: ["8010"], running: false },
        { name: "benchmark-ui", container_name: "docker-benchmark-ui-1", ports: ["8700"], running: false },
        { name: "automation-ui", container_name: "automation-ui", ports: ["8093"], running: false },
    ];

    let services = staticServices;
    let cMetrics = {};
    let pendingActions = {};  // container_name -> true while action in flight

    /* ---- helpers ---- */

    function tC(t) { return t >= 85 ? 'hot' : t >= 70 ? 'warm' : 'ok'; }
    function bC(p) { return p >= 90 ? 'crit' : p >= 70 ? 'warn' : ''; }

    /* ---- container actions ---- */

    async function containerAction(containerName, action) {
        if (pendingActions[containerName]) return;
        pendingActions[containerName] = true;
        render();

        try {
            const r = await fetch(`/api/docker/containers/${encodeURIComponent(containerName)}/${action}`, {
                method: 'POST',
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                console.error(`Action ${action} on ${containerName} failed:`, err.detail || r.statusText);
            }
        } catch (e) {
            console.error(`Action ${action} on ${containerName} failed:`, e);
        }

        delete pendingActions[containerName];
        // Refresh status after a brief delay for docker to settle
        setTimeout(() => refreshAll(), 500);
    }

    // Expose to onclick handlers
    window.containerAction = containerAction;

    /* ---- metrics ---- */

    async function fetchMetrics() {
        try { const r = await fetch('/api/metrics'); return r.ok ? r.json() : null; }
        catch { return null; }
    }

    function renderGpus(nvidia, amd) {
        const el = document.getElementById('gpuMetrics');
        const all = [
            ...(nvidia || []).map(g => ({ ...g, v: 'nvidia' })),
            ...(amd || []).map(g => ({ ...g, v: 'amd' })),
        ];

        if (!all.length) {
            el.innerHTML = '<div class="panel-placeholder">No GPU data available</div>';
            return;
        }

        el.innerHTML = all.map(g => {
            const u = g.utilization ?? 0;
            const vPct = g.vram_total_gb ? (g.vram_used_gb / g.vram_total_gb) * 100 : 0;
            return `<div class="gpu-card">
                <div class="gpu-top">
                    <div class="gpu-id">
                        <span class="gpu-vendor ${g.v}">${g.v.toUpperCase()}</span>
                        <span class="gpu-model">${g.name || g.v.toUpperCase() + ' GPU'}</span>
                    </div>
                    <span class="gpu-temp ${tC(g.temperature??0)}">${g.temperature??'--'}&deg;C</span>
                </div>
                <div class="gpu-metrics">
                    <div class="gpu-metric">
                        <span class="gm-label">Util</span>
                        <div class="gm-bar"><div class="gm-fill ${bC(u)}" style="width:${u}%"></div></div>
                        <span class="gm-val">${u.toFixed(0)}%</span>
                    </div>
                    <div class="gpu-metric">
                        <span class="gm-label">VRAM</span>
                        <div class="gm-bar"><div class="gm-fill ${bC(vPct)}" style="width:${vPct}%"></div></div>
                        <span class="gm-val">${(g.vram_used_gb??0).toFixed(1)} / ${(g.vram_total_gb??0).toFixed(0)} GB</span>
                    </div>
                    <div class="gpu-metric">
                        <span class="gm-label">Power</span>
                        <span class="gm-val" style="margin-left:auto">${(g.power_watts??0).toFixed(0)} W</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    function setRing(id, pct) {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('stroke-dasharray', `${pct}, 100`);
        el.classList.remove('warn', 'crit');
        if (pct >= 90) el.classList.add('crit');
        else if (pct >= 70) el.classList.add('warn');
    }

    function renderSystem(cpu, mem, ctr) {
        const cpuPct = cpu?.usage_percent ?? null;
        document.getElementById('cpuValue').textContent = cpuPct != null ? `${cpuPct.toFixed(0)}%` : '--';
        setRing('cpuRing', cpuPct ?? 0);

        const mUsed = mem?.used_gb, mTotal = mem?.total_gb;
        const mPct = (mUsed && mTotal) ? (mUsed / mTotal) * 100 : 0;
        document.getElementById('memValue').textContent = mUsed != null ? `${mPct.toFixed(0)}%` : '--';
        document.getElementById('memDetail').textContent = mUsed != null ? `${mUsed.toFixed(0)} / ${mTotal.toFixed(0)} GB` : '';
        setRing('memRing', mPct);

        document.getElementById('containerCount').textContent = ctr?.running_count ?? '--';
    }

    /* ---- services ---- */

    function controlBtns(s) {
        const cn = s.container_name || s.name;
        const busy = pendingActions[cn];
        const isPortal = cn === 'portal';

        if (busy) {
            return `<div class="svc-controls"><span class="ctrl-spinner"></span></div>`;
        }
        if (isPortal) {
            return `<div class="svc-controls"><span class="ctrl-note">self</span></div>`;
        }

        const startDisabled = s.running ? 'disabled' : '';
        const stopDisabled = !s.running ? 'disabled' : '';

        return `<div class="svc-controls">
            <button class="ctrl-btn start" ${startDisabled} onclick="containerAction('${cn}','start')" title="Start">
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>
            <button class="ctrl-btn stop" ${stopDisabled} onclick="containerAction('${cn}','stop')" title="Stop">
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            </button>
            <button class="ctrl-btn restart" ${stopDisabled} onclick="containerAction('${cn}','restart')" title="Restart">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>
        </div>`;
    }

    function cardHtml(s) {
        const cat = getServiceCategory(s.name);
        const badge = getCategoryBadge(cat);
        const desc = getServiceDescription(s.name);
        const port = getMainPort(s.name) || s.ports[0];
        const link = createAccessLink(s.name, port);
        const up = s.running;
        const cn = (s.container_name || s.name).toLowerCase().replace(/\s+/g, '-');
        const cm = cMetrics[cn] || cMetrics[s.container_name] || cMetrics[s.name] || null;

        return `<div class="svc ${up ? '' : 'off'}">
            <div class="svc-head">
                <div class="svc-ico ${cat}">${SERVICE_ICONS[cat] || SERVICE_ICONS.general}</div>
                <span class="svc-name">${s.name}</span>
                <span class="svc-dot ${up ? 'up' : 'dn'}"></span>
            </div>
            ${desc ? `<div class="svc-desc">${desc}</div>` : ''}
            <div class="svc-tags">
                <span class="tag ${badge.cls}">${badge.label}</span>
                <span class="tag-port">:${port}</span>
                ${cm ? `${cm.cpu_percent != null ? `<span class="tag-metric">CPU ${cm.cpu_percent.toFixed(1)}%</span>` : ''}${cm.memory_mb != null ? `<span class="tag-metric">${cm.memory_mb >= 1024 ? (cm.memory_mb/1024).toFixed(1)+'G' : cm.memory_mb.toFixed(0)+'M'}</span>` : ''}` : ''}
            </div>
            <div class="svc-actions">
                ${controlBtns(s)}
                <a href="${link}" target="_blank" class="svc-link">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    Open
                </a>
            </div>
        </div>`;
    }

    function render() {
        const q = searchInput.value.toLowerCase();
        const f = document.querySelector('.chip.active')?.dataset.filter || 'all';
        const list = services.filter(s => {
            if (!isMainService(s.name)) return false;
            const mq = !q || s.name.toLowerCase().includes(q) || getServiceDescription(s.name).toLowerCase().includes(q);
            return f === 'all' ? mq : mq && getServiceCategory(s.name) === f;
        });
        grid.innerHTML = list.length ? list.map(cardHtml).join('') : '<div class="no-services">No services match</div>';
    }

    /* ---- refresh ---- */

    async function refreshMetrics() {
        const d = await fetchMetrics();
        if (!d) return;
        renderGpus(d.nvidia_gpus, d.amd_gpus);
        renderSystem(d.cpu, d.memory, d.containers);
        cMetrics = d.containers?.per_container || {};
        render();
    }

    async function refreshServices() {
        try {
            const r = await fetch('/api/docker/services');
            if (!r.ok) return;
            const live = await r.json();
            if (live && live.length > 0) {
                const seen = new Set();
                const merged = [];
                for (const ls of live) {
                    seen.add(ls.name);
                    merged.push({
                        name: ls.name,
                        container_name: ls.container_name || ls.name,
                        project: ls.project || '',
                        ports: ls.ports || [],
                        running: ls.running,
                        status: ls.status || (ls.running ? 'running' : 'exited'),
                    });
                }
                // Keep static entries not yet seen (containers not created yet)
                for (const ss of staticServices) {
                    if (!seen.has(ss.name)) {
                        merged.push(ss);
                    }
                }
                merged.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
                services = merged;
            }
        } catch {}
        render();
    }

    async function refreshAll() {
        await Promise.all([refreshMetrics(), refreshServices()]);
    }

    /* ---- events ---- */

    refreshBtn.addEventListener('click', () => {
        refreshBtn.disabled = true;
        refreshAll().finally(() => { refreshBtn.disabled = false; });
    });

    searchInput.addEventListener('input', render);

    chips.forEach(c => {
        c.addEventListener('click', () => {
            chips.forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            render();
        });
    });

    /* ---- init ---- */
    render();
    refreshAll();
    setInterval(refreshAll, 10000);
});
