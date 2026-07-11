# Security Policy

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities or leaked credentials. Contact the repository owner privately through GitHub.

Include the affected component, reproduction steps, impact, and any suggested remediation. Do not include live production secrets.

## Supported versions

Only the latest release branch is supported during the initial development phase.

## Secret handling

The project must never return stored secrets after creation. Credentials are versioned, encrypted at rest, redacted from logs, and resolved only inside authorized workers.
