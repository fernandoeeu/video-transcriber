# Security Policy

## Supported versions

Only the `main` branch is supported. This project does not publish versioned releases.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open the repository **Security** tab and choose **Report a vulnerability**.

Do not open a public issue for a security report.

## Scope

This app runs locally on the operator's machine. There is no hosted server and no authentication.

Security-relevant surfaces include:

- Execution of external binaries (`yt-dlp`, `ffmpeg`, and the local Whisper engine `whisper-cli`) with user-supplied input (video URLs and related options)
- The configurable download folder used to store fetched audio

## Response

There is no formal SLA. The project is maintained by one person. Reports are reviewed as time allows.
