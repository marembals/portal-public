const SERVICE_ICONS = {
    observability: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
    </svg>`,
    ai: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4z"></path>
    </svg>`,
    database: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
    </svg>`,
    documents: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
    </svg>`,
    benchmarks: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20V10"></path>
        <path d="M18 20V4"></path>
        <path d="M6 20v-4"></path>
    </svg>`,
    general: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>`
};

const SERVICE_CATEGORIES = {
    prometheus: 'observability',
    grafana: 'observability',
    cadvisor: 'observability',
    blackbox_exporter: 'observability',
    jaeger: 'observability',
    qdrant: 'database',
    searxng: 'ai',
    comfyui: 'ai',
    open_webui: 'ai',
    ai_gateway: 'ai',
    paperless: 'documents',
    benchmark_ui: 'benchmarks',
    automation_ui: 'ai',
};

const SERVICE_DESCRIPTIONS = {
    prometheus: 'Metrics & monitoring',
    grafana: 'Dashboards & alerts',
    cadvisor: 'Container monitoring',
    blackbox_exporter: 'Network probes',
    jaeger: 'Distributed tracing',
    qdrant: 'Vector database',
    searxng: 'Metasearch engine',
    comfyui: 'AI image generation',
    open_webui: 'AI chat interface',
    ai_gateway: 'API gateway',
    paperless: 'Document management',
    benchmark_ui: 'Benchmark dashboard',
    automation_ui: 'Task automation',
};

// Main services have a user-facing web UI.
// Map: compose service name -> display port (the one users open in the browser).
// Services not listed here are dependencies and will be hidden.
const MAIN_SERVICES = {
    'prometheus':        '9091',
    'grafana':           '3001',
    'cadvisor':          '8080',
    'blackbox-exporter': '9115',
    'jaeger':            '16686',
    'qdrant':            '6333',
    'searxng':           '8081',
    'comfyui':           '8188',
    'open-webui':        '3000',
    'ai-gateway':        '8088',
    'paperless':         '8010',
    'benchmark-ui':      '8700',
    'automation-ui':     '8093',
};

function isMainService(name) {
    return name in MAIN_SERVICES;
}

function getMainPort(name) {
    return MAIN_SERVICES[name] || null;
}

function getServiceDescription(name) {
    const key = name.toLowerCase().replace(/[\s-]/g, '_');
    return SERVICE_DESCRIPTIONS[key] || SERVICE_DESCRIPTIONS[name] || '';
}

function getServiceCategory(name) {
    const key = name.toLowerCase().replace(/[\s-]/g, '_');
    return SERVICE_CATEGORIES[key] || SERVICE_CATEGORIES[name] || 'general';
}

function getCategoryBadge(cat) {
    const map = {
        observability: 'Observability',
        ai: 'AI',
        database: 'Database',
        documents: 'Documents',
        benchmarks: 'Benchmarks',
        general: 'General'
    };
    return { label: map[cat] || 'General', cls: cat || 'general' };
}

function createAccessLink(name, port) {
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
}
