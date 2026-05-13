#!/usr/bin/env python3
"""
Backend API for Docker Portal
Provides endpoints to discover and monitor docker services,
and aggregated metrics from Prometheus.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from docker import DockerClient
from docker.errors import NotFound as DockerNotFound
from typing import List, Dict, Any
import asyncio
import subprocess
import os
import re
from datetime import datetime, timezone

import httpx

app = FastAPI(title="Docker Portal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

docker = None
try:
    docker = DockerClient.from_env()
except Exception as e:
    print(f"Warning: Could not connect to Docker: {e}")

PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")

# Map compose project names to their compose file paths (on the host, mounted into container)
COMPOSE_PROJECTS = {
    "ai-stack": "/host-compose/docker-compose.yml",
    "docker": "/host-compose/model_benchmarks-public/docker/docker-compose.yml",
}

# Whitelist of valid service name characters to prevent injection
_SAFE_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


async def query_prometheus(query: str) -> list:
    """Execute an instant PromQL query and return the result vector."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.get(
                f"{PROMETHEUS_URL}/api/v1/query",
                params={"query": query},
            )
            data = resp.json()
            if data.get("status") == "success":
                return data["data"]["result"]
        except Exception as e:
            print(f"Prometheus query failed: {query} - {e}")
    return []


def _safe_float(results, index=0, default=0.0) -> float:
    try:
        return float(results[index]["value"][1])
    except (IndexError, KeyError, TypeError, ValueError):
        return default


def _build_gpu_dict(results_list: list, label_key: str) -> Dict[str, Dict]:
    """Group multiple metric results by a GPU label (e.g. 'gpu' or 'card')."""
    grouped: Dict[str, Dict] = {}
    for results in results_list:
        for r in results:
            key = r["metric"].get(label_key, "0")
            if key not in grouped:
                grouped[key] = {"metric": r["metric"]}
            # store by metric name
            name = r["metric"].get("__name__", "")
            grouped[key][name] = float(r["value"][1])
    return grouped


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "portal-api"}


@app.get("/api/docker/services")
async def get_services() -> List[Dict[str, Any]]:
    if not docker:
        return []
    services = []
    try:
        containers = docker.containers.list(all=True)
        for c in containers:
            svc_name = c.labels.get("com.docker.compose.service", c.name)
            project = c.labels.get("com.docker.compose.project", "")
            ports = []
            for port_key, bindings in (c.ports or {}).items():
                if bindings:
                    for b in bindings:
                        host_port = b.get("HostPort")
                        if host_port:
                            ports.append(host_port)
            services.append({
                "name": svc_name,
                "container_name": c.name,
                "project": project,
                "ports": ports,
                "running": c.status == "running",
                "status": c.status,
            })
    except Exception as e:
        print(f"Error listing containers: {e}")
    services.sort(key=lambda x: x["name"].lower())
    return services


@app.get("/api/docker/status")
async def get_service_status() -> Dict[str, bool]:
    if not docker:
        return {}
    status = {}
    try:
        containers = docker.containers.list(all=True)
        for c in containers:
            name = c.labels.get("com.docker.compose.service")
            if name:
                status[name] = c.status == "running"
    except Exception as e:
        print(f"Error getting service status: {e}")
    return status


def _find_container(name: str):
    """Find a container by container_name or compose service name."""
    if not docker:
        raise HTTPException(status_code=503, detail="Docker not connected")
    try:
        return docker.containers.get(name)
    except DockerNotFound:
        pass
    # Fallback: search by compose service label
    for c in docker.containers.list(all=True):
        if c.labels.get("com.docker.compose.service") == name:
            return c
    raise HTTPException(status_code=404, detail=f"Container '{name}' not found")


def _compose_cmd(project: str, *args):
    """Run a docker compose command for a known project."""
    compose_file = COMPOSE_PROJECTS.get(project)
    if not compose_file:
        return False
    try:
        subprocess.run(
            ["docker", "compose", "-f", compose_file, *args],
            check=True, capture_output=True, timeout=120,
        )
        return True
    except Exception as e:
        print(f"compose {args} failed: {e}")
        return False


# Projects where start/stop/restart should affect ALL services in the group.
# For large shared projects (ai-stack), we operate per-service instead.
_GROUP_PROJECTS = {"docker"}


@app.post("/api/docker/containers/{container_name}/{action}")
async def container_action(container_name: str, action: str) -> Dict[str, Any]:
    if action not in ("start", "stop", "restart"):
        raise HTTPException(status_code=400, detail=f"Invalid action: {action}")
    if not _SAFE_NAME_RE.match(container_name):
        raise HTTPException(status_code=400, detail="Invalid container name")

    container = _find_container(container_name)
    project = container.labels.get("com.docker.compose.project", "")
    svc_name = container.labels.get("com.docker.compose.service", container.name)

    try:
        if project and project in COMPOSE_PROJECTS:
            if project in _GROUP_PROJECTS:
                # Small self-contained project: operate on entire group
                if action == "stop":
                    await asyncio.to_thread(_compose_cmd, project, "stop")
                elif action == "restart":
                    await asyncio.to_thread(_compose_cmd, project, "restart")
                elif action == "start":
                    await asyncio.to_thread(_compose_cmd, project, "up", "-d")
            else:
                # Large shared project (ai-stack): operate on individual service only
                if action == "stop":
                    await asyncio.to_thread(_compose_cmd, project, "stop", svc_name)
                elif action == "restart":
                    await asyncio.to_thread(_compose_cmd, project, "restart", svc_name)
                elif action == "start":
                    await asyncio.to_thread(_compose_cmd, project, "up", "-d", svc_name)
        else:
            # Non-compose container: operate directly
            if action == "stop":
                await asyncio.to_thread(container.stop, timeout=30)
            elif action == "restart":
                await asyncio.to_thread(container.restart, timeout=30)
            elif action == "start":
                await asyncio.to_thread(container.start)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Refresh container state
    await asyncio.to_thread(container.reload)
    return {
        "container": container.name,
        "action": action,
        "status": container.status,
    }


@app.get("/api/metrics")
async def get_metrics() -> Dict[str, Any]:
    errors: List[str] = []

    (
        nvidia_util, nvidia_fb_used, nvidia_fb_free, nvidia_temp, nvidia_power,
        amd_util, amd_vram_used, amd_vram_free, amd_temp, amd_power,
        cpu_usage, mem_total, mem_available,
        container_cpu, container_mem,
    ) = await asyncio.gather(
        query_prometheus("DCGM_FI_DEV_GPU_UTIL"),
        query_prometheus("DCGM_FI_DEV_FB_USED"),
        query_prometheus("DCGM_FI_DEV_FB_FREE"),
        query_prometheus("DCGM_FI_DEV_GPU_TEMP"),
        query_prometheus("DCGM_FI_DEV_POWER_USAGE"),
        query_prometheus("gpu_gfx_activity"),
        query_prometheus("gpu_used_vram"),
        query_prometheus("gpu_free_vram"),
        query_prometheus("gpu_edge_temperature"),
        query_prometheus("gpu_average_package_power"),
        query_prometheus('100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
        query_prometheus("node_memory_MemTotal_bytes"),
        query_prometheus("node_memory_MemAvailable_bytes"),
        query_prometheus('rate(container_cpu_usage_seconds_total{name!=""}[5m]) * 100'),
        query_prometheus('container_memory_usage_bytes{name!=""}'),
    )

    # NVIDIA GPUs
    nvidia_gpus = []
    if nvidia_util:
        grouped = _build_gpu_dict(
            [nvidia_util, nvidia_fb_used, nvidia_fb_free, nvidia_temp, nvidia_power],
            "gpu",
        )
        for idx, data in sorted(grouped.items()):
            used_mib = data.get("DCGM_FI_DEV_FB_USED", 0)
            free_mib = data.get("DCGM_FI_DEV_FB_FREE", 0)
            total_mib = used_mib + free_mib
            nvidia_gpus.append({
                "index": idx,
                "name": data["metric"].get("modelName", f"NVIDIA GPU {idx}"),
                "utilization": data.get("DCGM_FI_DEV_GPU_UTIL", 0),
                "vram_used_gb": round(used_mib / 1024, 1),
                "vram_total_gb": round(total_mib / 1024, 0),
                "temperature": round(data.get("DCGM_FI_DEV_GPU_TEMP", 0)),
                "power_watts": round(data.get("DCGM_FI_DEV_POWER_USAGE", 0)),
            })
    else:
        errors.append("nvidia_gpu: no data")

    # AMD GPUs
    amd_gpus = []
    if amd_util:
        grouped = _build_gpu_dict(
            [amd_util, amd_vram_used, amd_vram_free, amd_temp, amd_power],
            "card",
        )
        for idx, data in sorted(grouped.items()):
            used_bytes = data.get("gpu_used_vram", 0)
            free_bytes = data.get("gpu_free_vram", 0)
            total_bytes = used_bytes + free_bytes
            amd_gpus.append({
                "index": idx,
                "name": data["metric"].get("model", f"AMD GPU {idx}"),
                "utilization": data.get("gpu_gfx_activity", 0),
                "vram_used_gb": round(used_bytes / (1024 ** 3), 1),
                "vram_total_gb": round(total_bytes / (1024 ** 3), 0),
                "temperature": round(data.get("gpu_edge_temperature", 0)),
                "power_watts": round(data.get("gpu_average_package_power", 0)),
            })
    else:
        errors.append("amd_gpu: no data")

    # CPU
    cpu_data = None
    if cpu_usage:
        cpu_data = {"usage_percent": round(_safe_float(cpu_usage), 1)}
    else:
        errors.append("cpu: no data")

    # Memory
    mem_data = None
    if mem_total and mem_available:
        total_gb = _safe_float(mem_total) / (1024 ** 3)
        avail_gb = _safe_float(mem_available) / (1024 ** 3)
        mem_data = {
            "used_gb": round(total_gb - avail_gb, 1),
            "total_gb": round(total_gb, 0),
        }
    else:
        errors.append("memory: no data")

    # Per-container metrics
    per_container: Dict[str, Dict] = {}
    for r in container_cpu:
        name = r["metric"].get("name", "")
        if name:
            per_container.setdefault(name, {})["cpu_percent"] = round(float(r["value"][1]), 2)
    for r in container_mem:
        name = r["metric"].get("name", "")
        if name:
            per_container.setdefault(name, {})["memory_mb"] = round(
                float(r["value"][1]) / (1024 * 1024), 1
            )

    running_count = 0
    if docker:
        try:
            running_count = len(docker.containers.list())
        except Exception:
            pass

    return {
        "nvidia_gpus": nvidia_gpus,
        "amd_gpus": amd_gpus,
        "cpu": cpu_data,
        "memory": mem_data,
        "containers": {
            "running_count": running_count,
            "per_container": per_container,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "errors": errors,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)
