// Mitigation vs. remediation guidance per vulnerability class.
//
// Mitigation = a temporary control that lowers the risk today while the real fix is built
// (a WAF rule, disabling a feature, a rate limit, restricting access).
// Remediation = the permanent fix of the root cause in code, configuration or access.
// Verification = a targeted retest of the original proof, so "fixed" is shown, not assumed.
//
// Plain data, matched on the finding's vulnerability class (case-insensitive keywords),
// with a generic fallback so every finding gets actionable next steps.

export interface RemediationGuide {
  /** Display label for the class family. */
  family: string;
  /** Why this matters, in one plain sentence. */
  risk: string;
  mitigate: string[];
  remediate: string[];
  /** What the retest should show once the fix is in. */
  verify: string;
}

interface Rule {
  match: RegExp;
  guide: RemediationGuide;
}

const RULES: Rule[] = [
  {
    match: /sql|sqli|injection/i,
    guide: {
      family: "Injection",
      risk: "Untrusted input reaches a database query, so an attacker can read or change data they should never see.",
      mitigate: [
        "Add a WAF rule that blocks SQL meta-characters on the affected parameter.",
        "Lower the privileges of the database account the endpoint uses (read-only where possible).",
        "Turn off verbose database errors in responses.",
      ],
      remediate: [
        "Replace string-built queries with parameterized queries or prepared statements.",
        "Validate the parameter against an allow-list (type, length, format).",
        "Add a regression test that sends the original payload and expects a safe error.",
      ],
      verify: "Replaying the original payload returns a generic error and no database data.",
    },
  },
  {
    match: /idor|bola|access control|authori[sz]/i,
    guide: {
      family: "Broken access control",
      risk: "The server trusts the object ID in the request, so one user can read or change another user's records.",
      mitigate: [
        "Rate-limit the endpoint per user to slow down bulk enumeration.",
        "Alert on one session requesting many different object IDs.",
        "If the data is sensitive, temporarily restrict the endpoint to internal users.",
      ],
      remediate: [
        "Check on the server that the signed-in user owns (or may access) every requested object.",
        "Centralise the ownership check in shared middleware instead of per-handler code.",
        "Prefer unguessable identifiers, but never as the only control.",
      ],
      verify: "Requesting another user's object returns 403 or 404, not 200 with their data.",
    },
  },
  {
    match: /default cred|credential|password|login/i,
    guide: {
      family: "Weak or default credentials",
      risk: "Anyone who tries the vendor's default password gets full administrator access.",
      mitigate: [
        "Restrict the admin console to the VPN or an IP allow-list right away.",
        "Enable login throttling and lockout.",
        "Review the access logs for logins with the default account.",
      ],
      remediate: [
        "Rotate the password to a unique, strong secret stored in the password vault.",
        "Disable or rename the default account; require MFA for administrators.",
        "Add a deployment check that fails when vendor defaults are present.",
      ],
      verify: "Logging in with the default credentials returns 401/403 instead of 200 OK.",
    },
  },
  {
    match: /jwt|token|session/i,
    guide: {
      family: "Token / session weakness",
      risk: "Tokens can be forged or replayed, so an attacker can impersonate any user.",
      mitigate: [
        "Shorten token lifetime and revoke the tokens issued so far.",
        "Reject tokens that use 'none' or unexpected algorithms at the gateway.",
      ],
      remediate: [
        "Rotate to a long random signing key (or switch to asymmetric RS256/ES256) held in a secret manager.",
        "Pin the accepted algorithm and validate issuer, audience and expiry on every request.",
      ],
      verify: "A token signed with the old or a guessed key is rejected with 401.",
    },
  },
  {
    match: /rce|deserial|command|exec/i,
    guide: {
      family: "Remote code execution",
      risk: "An attacker can run their own code on the server, the most severe outcome possible.",
      mitigate: [
        "Block the vulnerable route at the WAF or reverse proxy immediately.",
        "Isolate the host's outbound network access and watch it for signs of compromise.",
      ],
      remediate: [
        "Upgrade the vulnerable library to a fixed version, or turn off the unsafe feature (e.g. auto-type deserialization).",
        "Never deserialize untrusted input into arbitrary types; use strict schemas.",
        "Rebuild the host from a clean image if compromise cannot be ruled out.",
      ],
      verify: "The original payload no longer triggers execution (no callback, no command output).",
    },
  },
  {
    match: /xss|cross.site script/i,
    guide: {
      family: "Cross-site scripting",
      risk: "Attacker-supplied script runs in a victim's browser and can steal their session.",
      mitigate: [
        "Add a strict Content-Security-Policy that blocks inline script.",
        "Set session cookies to HttpOnly and SameSite.",
      ],
      remediate: [
        "Encode output for its context (HTML, attribute, JavaScript, URL) using the framework's escaping.",
        "Validate and sanitise rich-text input with a vetted library.",
      ],
      verify: "The payload is rendered as text, and no script executes.",
    },
  },
  {
    match: /\.git|exposed|disclos|verbose|stack trace|error/i,
    guide: {
      family: "Information disclosure",
      risk: "Internal details (source code, stack traces, versions) give attackers a map for their next step.",
      mitigate: [
        "Block the exposed path at the web server or WAF.",
        "Turn off debug or verbose error output in production.",
      ],
      remediate: [
        "Remove the exposed files from the web root and fix the deployment that copied them.",
        "Rotate any secrets found in the disclosed material.",
        "Return generic error pages and log details server-side only.",
      ],
      verify: "The path returns 403/404 and errors no longer reveal internal details.",
    },
  },
  {
    match: /header|hsts|csp|tls|ssl/i,
    guide: {
      family: "Hardening gap",
      risk: "A missing protective header makes other attacks easier to pull off.",
      mitigate: ["Add the header at the CDN or reverse proxy."],
      remediate: ["Set the security headers in the application's base configuration so every response carries them."],
      verify: "Every response carries the expected security headers.",
    },
  },
];

const FALLBACK: RemediationGuide = {
  family: "General",
  risk: "The weakness was demonstrated against a live asset and should be contained and fixed.",
  mitigate: [
    "Restrict access to the affected asset (VPN, IP allow-list or WAF rule) while the fix is built.",
    "Increase monitoring on the asset for signs of abuse.",
  ],
  remediate: [
    "Fix the root cause in code or configuration, following the finding's detailed report.",
    "Add a regression test that reproduces the original proof.",
  ],
  verify: "Replaying the recorded proof no longer reproduces the issue.",
};

export function remediationFor(vulnclass: string, name = ""): RemediationGuide {
  const hay = `${vulnclass} ${name}`;
  return RULES.find((r) => r.match.test(hay))?.guide ?? FALLBACK;
}
