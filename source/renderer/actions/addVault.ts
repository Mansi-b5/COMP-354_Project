import { ipcRenderer } from "electron";
import { VaultSourceID } from "buttercup";
import { setBusy } from "../state/app";
import { logInfo } from "../library/log";
import { getCreateNewFilePromptEmitter, getVaultAdditionEmitter } from "../services/addVault";
import { showNewFilePrompt } from "../state/addVault";
import { handleError } from "../actions/error";
import { AddVaultPayload, DatasourceConfig } from "../types";

type NewVaultChoice = "new" | "existing" | null;

function checkPasswordStrength(password) {
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasNonAlphas = /\W/.test(password);

    const isLongEnough = password.length >= 16;
    const isMediumLength = password.length >= 8 && password.length <= 11;

    if (isLongEnough && hasUpperCase && hasLowerCase && hasNumbers && hasNonAlphas) {
        return "strong";
    } else {
        return "weak";
    }
}

export async function addNewVaultTarget(
    datasourceConfig: DatasourceConfig,
    password: string,
    createNew: boolean,
    fileNameOverride: string | null = null
): Promise<VaultSourceID> {
    // Check password strength

    const passwordStrength = checkPasswordStrength(password);

    setBusy(true);
    const addNewVaultPromise = new Promise<VaultSourceID>((resolve, reject) => {
        if (passwordStrength === "weak") {
            logInfo(`Password is weak`);
            ipcRenderer.send("show-error", `Password is weak`); // Send error to main process
            reject(new Error(`Password is too weak`));
        }
        ipcRenderer.once("add-vault-config:reply", (evt, payload) => {
            if (passwordStrength === "strong") {
                logInfo(`Password is strong`);

                const { ok, error, sourceID } = JSON.parse(payload) as {
                    ok: boolean;
                    error?: string;
                    sourceID?: VaultSourceID;
                };
                if (ok) return resolve(sourceID);
            }
        });
    });
    const payload: AddVaultPayload = {
        createNew,
        datasourceConfig,
        masterPassword: password,
        fileNameOverride
    };
    logInfo(`Adding new vault: ${datasourceConfig.type}`);
    ipcRenderer.send("add-vault-config", JSON.stringify(payload));
    try {
        const sourceID = await addNewVaultPromise;
        setBusy(false);
        getVaultAdditionEmitter().emit("vault-added", sourceID);
        return sourceID;
    } catch (err) {
        handleError(err);
        setBusy(false);
    }
    return null;
}

export async function getFileVaultParameters(): Promise<{
    filename: string;
    createNew: boolean;
} | null> {
    showNewFilePrompt(true);
    const emitter = getCreateNewFilePromptEmitter();
    const choice: NewVaultChoice = await new Promise<NewVaultChoice>((resolve) => {
        const callback = (choice: NewVaultChoice) => {
            resolve(choice);
            emitter.removeListener("choice", callback);
        };
        emitter.once("choice", callback);
    });
    showNewFilePrompt(false);
    if (!choice) return null;
    if (choice === "new") {
        const filename = await ipcRenderer.invoke("get-new-vault-filename");
        if (!filename) return null;
        return {
            filename,
            createNew: true
        };
    } else {
        const filename = await ipcRenderer.invoke("get-existing-vault-filename");
        if (!filename) return null;
        return {
            filename,
            createNew: false
        };
    }
}
