# GitHub Actions CI/CD Prerequisites

This note helps you prepare for the GitHub Actions and CI/CD session on **22 Oct**.

Complete these steps before the session. We will create repositories, workflows, and secrets together during the session.

## 1. What You Need Before The Session

Required:

- GitHub account
- Git installed on VM
- VS Code Git support working
- GitHub sign-in from VS Code
- GitHub Actions extension in VS Code
- Azure Cloud Shell access

Optional:

- Docker Desktop
- Azure CLI installed on VM

Docker Desktop is optional because we can use Azure Container Registry build from Cloud Shell.

## 2. Create A GitHub Account

Go to:

```text
https://github.com
```

Create an account or sign in with an existing account.

Complete:

- email verification
- MFA if GitHub asks for it
- login test from browser

Keep your GitHub username ready.

## 3. Install Git On VM

Download Git for Windows:

```text
https://git-scm.com/download/win
```

Install using default options.

After installation, restart VS Code or open a new terminal.

Verify:

```powershell
git --version
```

Expected example:

```text
git version 2.x.x
```

## 4. Configure Git Identity

Run:

```powershell
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
```

Verify:

```powershell
git config --global --list
```

You should see:

```text
user.name=...
user.email=...
```

Use the same email you use for GitHub if possible.

## 5. Check VS Code Git Support

Open VS Code.

Check the left sidebar for:

```text
Source Control
```

It looks like a branch icon.

If Git is installed correctly, VS Code should detect it automatically.

If VS Code does not detect Git:

1. close VS Code,
2. reopen VS Code,
3. open a new terminal,
4. run `git --version` again.

## 6. Sign In To GitHub From VS Code

In VS Code:

1. Click the Accounts icon in the bottom-left corner.
2. Select **Sign in to GitHub**.
3. Browser will open.
4. Approve VS Code access.
5. Return to VS Code.

Verify:

- VS Code shows your GitHub account
- no sign-in error appears

## 7. Install GitHub Actions Extension

In VS Code:

1. Open Extensions.
2. Search:

```text
GitHub Actions
```

3. Install the official GitHub Actions extension.

This extension helps view workflows later.

## 8. Check Azure Cloud Shell

Go to:

```text
https://portal.azure.com
```

Open Cloud Shell from the top-right terminal icon.

Choose:

```text
Bash
```

Run:

```bash
az account show --output table
```

Expected:

- your subscription is visible
- no login error

Cloud Shell already has:

- Azure CLI
- Git
- basic build tools

## 9. Optional: Azure CLI On VM

This is optional because Cloud Shell is enough.

If you want Azure CLI on your VM:

```text
https://learn.microsoft.com/cli/azure/install-azure-cli-windows
```

Verify:

```powershell
az --version
az login
```

## 10. Optional: Docker Desktop

Docker Desktop is optional.

Use it only if your VM supports it and installation is smooth.

Download:

```text
https://www.docker.com/products/docker-desktop/
```

Verify:

```powershell
docker --version
```

If Docker setup takes too long, skip it. We will use ACR build from Cloud Shell.

## 11. What We Will Do During The CI/CD Session

We will do these together on **22 Oct**:

- create or use a GitHub repository
- push project code
- create GitHub Actions workflow
- add GitHub Actions secrets
- build backend image
- push image to Azure Container Registry
- update Azure Container App
- validate deployment
- discuss rollback

## 12. Do Not Do These Yet

You do not need to do these before the session:

- create GitHub Actions workflow
- create GitHub Actions secrets
- connect Azure from GitHub
- create service principal
- push production code
- change deployed Container App

We will do these step by step in class.

## 13. Pre-Session Checklist

| Check | Done |
|---|---|
| GitHub account created | |
| GitHub email verified | |
| Git installed | |
| `git --version` works | |
| Git user name/email configured | |
| VS Code Source Control visible | |
| VS Code signed in to GitHub | |
| GitHub Actions extension installed | |
| Azure Cloud Shell opens | |
| `az account show` works in Cloud Shell | |
| Docker Desktop installed, optional | |
| Azure CLI installed on VM, optional | |

## 14. Learning Summary

For CI/CD, GitHub stores the code, GitHub Actions runs the automation, Azure Container Registry stores the image, and Azure Container Apps runs the backend.

Before the session, focus only on account access and basic tooling.
