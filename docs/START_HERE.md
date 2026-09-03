# Start here: NeuralLoom for complete beginners

This guide assumes you have never used a terminal, installed a developer tool, or worked with AI models. Follow it top to bottom and you will go from nothing to your first safe AI task in about 30 minutes.

If you get stuck at any step, jump to [If something goes wrong](#if-something-goes-wrong) at the bottom.

## What you need before starting

- A computer running Windows or macOS that you can install programs on.
- An internet connection.
- About 30 minutes.

You do **not** need a credit card, programming knowledge, or any prior experience with AI.

## One idea to understand first

You will use one app called a **terminal**. It is a window where you type a command and press Enter, and the computer runs it. That is all a terminal is. Every command you need is written in this guide exactly as you should type it.

---

## Step 1: Install Node.js

Node.js is the engine that runs NeuralLoom on your computer.

1. Go to [nodejs.org](https://nodejs.org/).
2. Click the big green download button (it says **LTS** — that is the right one).
3. Open the downloaded file and click through the installer. The standard options are fine — just keep clicking **Next**, then **Finish**.

✅ **You are done with this step when** the installer says it finished successfully.

## Step 2: Install Ollama

Ollama is the app that connects NeuralLoom to AI models.

1. Go to [ollama.com/download](https://ollama.com/download).
2. Download the version for your computer (Windows or Mac).
3. Open the downloaded file and install it.
4. **Open the Ollama app** after installing. On Windows and Mac it runs quietly in the background — you may only see a small llama icon in your taskbar or menu bar. That means it is working.

✅ **You are done with this step when** Ollama is installed and open. Leave it running.

## Step 3: Download NeuralLoom

1. Go to the NeuralLoom page on GitHub.
2. Click the green **Code** button, then click **Download ZIP**.
3. Find the downloaded ZIP file (usually in your Downloads folder).
4. Unzip it:
   - **Windows:** right-click the file and choose **Extract All…**, then **Extract**.
   - **Mac:** double-click the file.

You now have a folder named something like `NeuralLoom-main`. Remember where it is.

✅ **You are done with this step when** you can open that folder and see files inside it, including one called `package.json`.

## Step 4: Open a terminal in that folder

This is the trickiest step for a beginner, so here it is exactly:

**Windows:**

1. Open the `NeuralLoom-main` folder in File Explorer.
2. Click once on the address bar at the top (where the folder path is shown).
3. Type `cmd` and press Enter.

A black window opens. That is your terminal, already pointed at the right folder.

**Mac:**

1. Open the **Terminal** app (press `Cmd + Space`, type `terminal`, press Enter).
2. Type `cd ` (the letters c and d, then one space — do not press Enter yet).
3. Drag the `NeuralLoom-main` folder from Finder onto the terminal window. The folder's path appears.
4. Press Enter.

✅ **You are done with this step when** you have a terminal window open and it shows the NeuralLoom folder name or path.

Keep this terminal window open for the rest of the guide. Every command below is typed here.

## Step 5: Set up NeuralLoom

Type this and press Enter:

```text
npm run setup
```

This downloads what NeuralLoom needs and then checks your computer. It can take a few minutes. Lines starting with `✓` are good. Lines starting with `✗` tell you what is missing — usually the next step fixes them.

> If the terminal says `npm is not recognized`, close the terminal, open a new one (Step 4 again), and retry. If it still fails, restart your computer once — this finishes the Node.js installation.

✅ **You are done with this step when** the command finishes. It is normal if it says setup needs attention — the next step fixes that.

## Step 6: Get the two starter AI models

NeuralLoom uses one AI model to do the work and a second, independent one to review the answer. Get both with a free Ollama account:

1. Type this and press Enter, then follow the sign-in instructions it shows (it creates or uses a free account at ollama.com):

```text
ollama signin
```

2. Then run these two commands, one at a time, pressing Enter after each:

```text
ollama pull kimi-k2.7-code:cloud
```

```text
ollama pull gemma4:31b-cloud
```

3. Now check that everything is ready:

```text
npm run doctor
```

✅ **You are done with this step when** the check ends with:

```text
Ready. Run: npm run dev
```

## Step 7: Start NeuralLoom

Type this and press Enter:

```text
npm run dev
```

Wait a few seconds, then open your web browser and go to:

**http://localhost:8080**

That address is your own computer — NeuralLoom runs entirely on your machine, in this terminal window. Leave the terminal open while you use it.

✅ **You are done with this step when** the NeuralLoom home page appears in your browser.

## Step 8: Try your first task (a safe one)

1. In NeuralLoom, choose **Start a new task**.
2. In the task description, type:
   > Review this example code idea and suggest a refactoring plan: a function that copies the same three lines of error handling into ten different places.
3. Give it a short name like `First test`.
4. For the information type, choose **Public or example material**.
5. Submit the task and watch what happens: NeuralLoom picks an approved model, gets an answer, has the second model review it independently, and shows you the result with a full audit trail.

✅ **You are done when** you see a reviewed result. Congratulations — that is the whole workflow.

## Step 9: Stopping and starting again later

- **To stop:** click on the terminal window and press `Ctrl + C` (on Mac too: Control, not Command). You can then close the window.
- **To start again later:** open a terminal in the folder (Step 4) and run `npm run dev` (Step 7). Ollama must be open, as always.

---

## Three rules that keep you safe

NeuralLoom is a safety layer, and it will block unsafe requests — but these rules matter everywhere, not just here:

1. **Never paste passwords, API keys, or other secrets** into a task — or into any AI tool. NeuralLoom refuses tasks containing them by design.
2. **Answer the information-type question honestly.** It controls which models are allowed to see your task. "Public or example material" is always the safe choice for practice.
3. **Treat AI answers as suggestions.** NeuralLoom's independent reviewer catches many problems, but a human (you) always makes the final call.

## If something goes wrong

| What you see                                  | What to do                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm is not recognized` / `command not found` | Close the terminal, open a new one (Step 4), retry. Still failing? Restart the computer and try again.             |
| `ollama is not recognized`                    | Install Ollama (Step 2), then open a **new** terminal and retry.                                                   |
| `Ollama is not reachable`                     | Open the Ollama app so it is running (look for the llama icon), then run `npm run doctor` again.                   |
| Doctor says no review path is available       | Redo Step 6 — both `ollama pull` commands must finish, signed in to your Ollama account.                           |
| The browser page will not load                | Make sure `npm run dev` is still running in the terminal, and that the address is exactly `http://localhost:8080`. |
| Anything else                                 | See the full [Troubleshooting section](GETTING_STARTED.md#troubleshooting) in the complete guide.                  |

## Where to go next

- The complete [Getting Started Guide](GETTING_STARTED.md) explains everything this page skipped: what each safety control does, all the task types, advanced options, and configuration.
- The **Models** page inside NeuralLoom lets you pick different AI models for each job — including models installed on your own computer and, optionally, Claude, ChatGPT, or Grok.
