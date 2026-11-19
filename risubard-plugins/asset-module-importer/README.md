# Asset Module Importer v0.1.0

A standalone RisuBard API v3.0 plugin to restore legacy `.risum` asset modules on Android without using the RisuBard built-in module file picker/parser.

## Install and use
1. Install `Asset_Module_Importer_v0.1.0.ts` via RisuBard Settings > Plugins > Import (supports .ts).
2. Open `📦 에셋 모듈 가져오기` from plugin settings or the hamburger menu. No extra floating action icon.
3. Choose a locally downloaded `.risum` file, wait for a *metadata scan* to finish, review module name/asset count, then click **이 모듈 가져오기**.
4. The plugin reads encoded images in individual `File.slice()` ranges, decodes the RPack substitution, sends assets one at a time through `risuai.saveAsset()`, and calls `risuai.setDatabase()` only after all assets have been stored successfully.
5. The default is not to enable the module automatically. Turn on `등록 즉시 활성화` before import if desired.

## Safety / limitations
- Never replaces existing module data, IDs, or mappings. Resolves duplicate names by suffixing them.
- Script/regex/trigger fields are excluded by default; explicit opt-in is offered only if the module contains them. `lowLevelAccess` and MCP modules are rejected.
- Supports legacy `.risum` only, not `.charx` or `.zip`. Do not unzip `.risum`.
- If the Android file picker itself cannot open the selected content URI, a plugin may fail too. Copy the original file to the device's local Downloads folder and retry.
- Interruption after assets have been stored may leave orphan assets (there is no safe plugin API for selective asset deletion). Incomplete modules are never added to the database.
- Large single compressed assets above 128 MiB are refused to avoid allocating excessive device memory. The surrounding file can be much larger.
- Not verified on a real Android device yet; tested against a simulated API and generated `.risum` with the verified RPack 512-byte mapping.
- Works independently of Asset Link Bridge. After import, use Asset Link Bridge to associate the module to characters if necessary.
