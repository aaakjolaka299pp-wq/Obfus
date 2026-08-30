<div align="center">

# ZerServer

**Advanced Script Management & Protection Server**

A powerful server platform designed to manage, protect, and distribute Luau scripts with an integrated Key System, Obfuscator, Script Management, and Roblox Loader.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](./LICENSE)

</div>

---

## Overview

ZerServer is a centralized server platform for managing Luau scripts, access keys, and script distribution.

The system is designed with multiple connected features that allow developers and administrators to manage their scripts from a single dashboard.

ZerServer includes a built-in **Obfuscator, Key System, Script Manager, API, Roblox Loader, Settings, and Documentation.**

Scripts and access data are managed through the server, allowing administrators to control which users and Roblox Place IDs can access specific scripts.

### Key Features

- **Obfuscator** — Protect Luau scripts before distribution
- **Key System** — Create and manage access keys
- **Place ID Protection** — Connect keys and scripts to specific Place IDs
- **Script Management** — Manage scripts, versions, and status
- **Roblox Loader** — Connect Roblox scripts directly to ZerServer
- **Server-Side Storage** — Keep managed scripts on the server
- **Access Control** — Control access to scripts through the backend
- **Dashboard** — Manage the entire system from one interface
- **API** — Backend API for loader and external integrations
- **Settings** — Configure ZerServer system options
- **Documentation** — Built-in documentation for system integration
Key Features


---

Dashboard

ZerServer provides a centralized dashboard for managing the entire platform.

The dashboard contains several separate sections:

- Obfuscator
- Key System
- Scripts
- Settings
- Documentation

Each section has its own purpose and management interface.

---

Obfuscator

The Obfuscator allows developers to process their Luau scripts before storing or distributing them.

Users can enter their script, configure the available protection options, and generate the protected output.

The resulting script can then be connected to the ZerServer Script Manager and Roblox Loader.

---

Key System

The Key System provides access control for ZerServer scripts.

Administrators can create keys and assign them to specific scripts and Place IDs.

Each key can have its own configuration such as:

- Key status
- Expiration
- Script access
- Place ID
- Usage status
- Activation state

Example:

Key: ZER-XXXX-XXXX
Status: Active
Script: Main
Place ID: 123456789
Expiration: 30 Days

---

Scripts

The Scripts section is used to manage all scripts stored in ZerServer.

Administrators can manage:

- Script name
- Script version
- Script status
- Connected Place IDs
- Access keys
- Script updates
- Script delivery

Example:

Main Script
Version: 1.0.0
Status: Active

Premium Script
Version: 2.1.0
Status: Active

Test Script
Version: 0.5.0
Status: Disabled

---

Roblox Loader

ZerServer can be connected to a Roblox Loader.

The loader communicates with the ZerServer API to request the required script.

The server can check the request before allowing script access.

Roblox Loader
      ↓
ZerServer API
      ↓
Key Validation
      ↓
Place ID Validation
      ↓
Script Validation
      ↓
Script Delivery

If the request does not meet the configured requirements, access can be denied.

---

API

ZerServer provides an API for communication between the dashboard, Roblox Loader, and external services.

Example API structure:

/api/auth
/api/keys
/api/scripts
/api/loader
/api/settings
/api/status

The API can be used for:

- Key validation
- Script requests
- Script management
- Loader communication
- System status
- Authentication

---

Server Storage

ZerServer uses server-side storage for managed scripts and system data.

The general structure is:

ZerServer
│
├── Dashboard
│
├── Key System
│
├── Obfuscator
│
├── Script Manager
│
├── API
│
└── Server Storage
      │
      ├── Scripts
      ├── Keys
      ├── Users
      └── Configuration

This allows the administrator to manage script access without placing all management logic directly inside the client.

---

Settings

The Settings section provides configuration for the ZerServer system.

Available settings may include:

- Server configuration
- API configuration
- Key configuration
- Script settings
- Loader settings
- Security configuration
- Default system options

---

Documentation

ZerServer includes documentation for developers and administrators.

Documentation can cover:

- API usage
- Roblox Loader
- Key System
- Script Management
- Authentication
- Configuration
- Integration

---

Getting Started

Requirements

- Node.js 18+
- npm 9+
- Database
- Server environment

Installation

git clone <your-repository>
cd ZerServer
npm install
npm run build

Start Server

node dist/server.js

Open the configured server address to access the ZerServer dashboard.

---

System Flow

Developer
    ↓
ZerServer Dashboard
    ↓
Obfuscator
    ↓
Script Manager
    ↓
Server Storage
    ↓
Key System
    ↓
Roblox Loader
    ↓
ZerServer API
    ↓
Access Validation
    ↓
Script Delivery

---

License

This project is licensed under the "MIT License" (./LICENSE).

---

<div align="center">ZerServer

Script Protection • Key System • Script Management • Roblox Loader

</div>
