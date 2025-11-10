"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const fsPromises = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
let notesProvider;
const DEBUG = false;
function log(message, ...args) {
    if (DEBUG) {
        console.log(`[QuickNotes] ${message}`, ...args);
    }
}
// Global funktion för att läsa inställningar
function getSettings() {
    return vscode.workspace.getConfiguration('quickNotes');
}
// Funktion för att hämta dynamiska taggar och färger
function getCustomTagsAndColors() {
    const settings = getSettings();
    const customTagsConfig = settings.get('customTags') || {};
    const tags = [];
    const sidebarTags = [];
    const calendarTags = [];
    const colors = {};
    for (const key in customTagsConfig) {
        if (customTagsConfig.hasOwnProperty(key)) {
            const tagName = key.toUpperCase();
            const config = customTagsConfig[key];
            tags.push(tagName);
            colors[tagName] = config.color || '#FFFFFF';
            if (config.appliesToCalendar === true) {
                calendarTags.push(tagName);
            }
            if (config.color || config.visibleInSidebar !== false) {
                sidebarTags.push(tagName);
            }
        }
    }
    return { tags, sidebarTags, calendarTags, colors };
}
// Konstanter för Globala mappar
const DAILY_NOTES_FOLDER_NAME = "Daily-notes";
const DAILY_NOTES_DISPLAY_NAME = "Daily Notes";
const GLOBAL_NOTES_FOLDER_NAME = "Global-notes"; // NY GLOBAL MAPPA
const GLOBAL_NOTES_DISPLAY_NAME = "Global Notes"; // NYTT VISNINGSNAMN
function activate(context) {
    log('Quick Notes extension is now active');
    notesProvider = new NotesViewProvider(context.extensionUri, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('quickNotesView', notesProvider));
    const globPattern = '**/*.md';
    log(`Starting file watcher for pattern: ${globPattern}`);
    let fileWatcher = vscode.workspace.createFileSystemWatcher(globPattern);
    fileWatcher.onDidCreate(() => {
        log('File watcher: .md file created. Updating...');
        notesProvider.refresh();
    });
    fileWatcher.onDidChange(() => {
        log('File watcher: .md file changed. Updating...');
        notesProvider.refresh();
    });
    fileWatcher.onDidDelete(() => {
        log('File watcher: .md file deleted. Updating...');
        notesProvider.refresh();
    });
    context.subscriptions.push(fileWatcher);
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        log("Workspace changed. Updating notes.");
        notesProvider.refresh();
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('quickNotes.notesFolder') ||
            e.affectsConfiguration('quickNotes.customTags')) {
            log("Settings changed. Updating...");
            notesProvider.refresh();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('quickNotes.newNote', async () => {
        const notesFolder = await notesProvider.getProjectNotesFolder();
        const globalFolder = notesProvider.getGlobalNotesFolder();
        // FIXAT: Hämta undermappar från BÅDA källorna
        const allProjectFolders = await notesProvider.getFolders(notesFolder);
        const allGlobalFolders = await notesProvider.getFolders(globalFolder);
        const quickPickItems = [
            // Globala val
            { label: `$(globe) Spara i Global Notes (Roten)`, folderName: undefined, isGlobal: true },
            ...allGlobalFolders.map(f => ({
                label: `$(globe) ${f}`,
                folderName: f,
                isGlobal: true
            })),
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            // Projektval
            { label: "$(file-directory) Spara i Projektmapp (Roten)", folderName: undefined, isGlobal: false },
            ...allProjectFolders
                .filter(f => f !== DAILY_NOTES_FOLDER_NAME && f !== GLOBAL_NOTES_FOLDER_NAME)
                .map(f => ({ label: `$(folder) ${f}`, folderName: f, isGlobal: false }))
        ];
        if (!notesFolder) {
            quickPickItems[quickPickItems.length - 2].description = "Öppna en mapp för att se projektanteckningar";
            quickPickItems.splice(quickPickItems.length - 1); // Ta bort projektmapparna
        }
        const selection = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: "Välj en mapp att spara anteckningen i (Global eller Projekt)"
        });
        if (!selection) {
            return;
        }
        const title = await vscode.window.showInputBox({
            prompt: 'Ange titel för anteckningen',
            placeHolder: 'Min Anteckning'
        });
        if (title) {
            const targetBasePath = selection.isGlobal ? globalFolder : notesFolder;
            await notesProvider.createNote(title, false, selection.folderName, targetBasePath);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('quickNotes.newTodo', async () => {
        const notesFolder = await notesProvider.getProjectNotesFolder();
        const globalFolder = notesProvider.getGlobalNotesFolder();
        // FIXAT: Hämta undermappar från BÅDA källorna
        const allProjectFolders = await notesProvider.getFolders(notesFolder);
        const allGlobalFolders = await notesProvider.getFolders(globalFolder);
        const quickPickItems = [
            // Globala val
            { label: `$(globe) Spara i Global Notes (Roten)`, folderName: undefined, isGlobal: true },
            ...allGlobalFolders.map(f => ({
                label: `$(globe) ${f}`,
                folderName: f,
                isGlobal: true
            })),
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            // Projektval
            { label: "$(file-directory) Spara i Projektmapp (Roten)", folderName: undefined, isGlobal: false },
            ...allProjectFolders
                .filter(f => f !== DAILY_NOTES_FOLDER_NAME && f !== GLOBAL_NOTES_FOLDER_NAME)
                .map(f => ({ label: `$(folder) ${f}`, folderName: f, isGlobal: false }))
        ];
        if (!notesFolder) {
            quickPickItems[quickPickItems.length - 2].description = "Öppna en mapp för att se projektanteckningar";
            quickPickItems.splice(quickPickItems.length - 1); // Ta bort projektmapparna
        }
        const selection = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: "Välj en mapp att spara TODO-listan i (Global eller Projekt)"
        });
        if (!selection) {
            return;
        }
        const title = await vscode.window.showInputBox({
            prompt: 'Ange titel för todolistan',
            placeHolder: 'Min Todolista'
        });
        if (title) {
            const targetBasePath = selection.isGlobal ? globalFolder : notesFolder;
            await notesProvider.createNote(title, true, selection.folderName, targetBasePath);
        }
    }));
    context.subscriptions.push(
    // FIXAT: Uppdaterat kommandot för att hantera Global vs Projekt
    vscode.commands.registerCommand('quickNotes.newFolder', async () => {
        const projectFolder = await notesProvider.getProjectNotesFolder();
        const globalFolder = notesProvider.getGlobalNotesFolder();
        const quickPickItems = [];
        // Du kan alltid skapa en global mapp
        quickPickItems.push({ label: `$(globe) Skapa i Global Notes`, basePath: globalFolder });
        // Du kan bara skapa en projektmapp om ett projekt är öppet
        if (projectFolder) {
            quickPickItems.push({ label: `$(file-directory) Skapa i Projektmapp`, basePath: projectFolder });
        }
        let basePath = globalFolder; // Standard är Global om inget projekt är öppet
        if (projectFolder) {
            // Fråga bara om båda alternativen finns
            const selection = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: "Var vill du skapa den nya mappen?"
            });
            if (!selection) {
                return;
            }
            basePath = selection.basePath;
        }
        const folderName = await vscode.window.showInputBox({
            prompt: 'Ange mappnamn',
            placeHolder: 'My Folder'
        });
        if (folderName) {
            // Anropa createFolder med den valda bassökvägen
            await notesProvider.createFolder(folderName, basePath);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('quickNotes.refresh', () => {
        log("Manual refresh called.");
        notesProvider.refresh();
    }));
}
class NotesViewProvider {
    constructor(_extensionUri, context) {
        this._extensionUri = _extensionUri;
        this._context = context;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                log("Panel became visible, updating.");
                this.sendNotesToWebview();
            }
        });
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'openNote':
                    this.openNote(data.filePath);
                    break;
                case 'deleteNote':
                    await this.deleteNote(data.filePath, data.title);
                    break;
                case 'toggleTodo':
                    await this.toggleTodo(data.filePath, data.lineNumber);
                    break;
                case 'dateClicked':
                    await this.createNoteFromDate(data.date);
                    break;
                case 'requestNotes':
                    this.sendNotesToWebview();
                    break;
                case 'pinNote':
                    await this.togglePinNote(data.filePath);
                    break;
                case 'moveToFolder':
                    await this.moveNoteToFolder(data.filePath, data.folderName);
                    break;
                case 'getFolders':
                    this.sendFoldersToWebview();
                    break;
            }
        });
        this.sendNotesToWebview();
    }
    async refresh() {
        await this.sendNotesToWebview();
    }
    async sendNotesToWebview() {
        if (this._view) {
            // UPPDATERAD: Skickar nu med alla tre sökvägarna
            const notesData = await this.getNotes(await this.getProjectNotesFolder(), this.getDailyNotesFolder(), this.getGlobalNotesFolder());
            const tagsAndColors = getCustomTagsAndColors();
            this._view.webview.postMessage({
                type: 'notesUpdate',
                notesData: notesData,
                tagColors: tagsAndColors.colors
            });
        }
    }
    async sendFoldersToWebview() {
        if (this._view) {
            // Denna funktion skickar nu bara projektmappar (för "Move to Folder")
            const projectFolder = await this.getProjectNotesFolder();
            const projectFolders = await this.getFolders(projectFolder);
            const foldersToSend = projectFolders.filter(f => f !== DAILY_NOTES_FOLDER_NAME && f !== GLOBAL_NOTES_FOLDER_NAME);
            this._view.webview.postMessage({ type: 'foldersUpdate', folders: foldersToSend });
        }
    }
    async getFolders(notesFolder) {
        if (!notesFolder) {
            return [];
        }
        try {
            await fsPromises.access(notesFolder);
            const items = await fsPromises.readdir(notesFolder);
            const folders = [];
            for (const item of items) {
                const itemPath = path.join(notesFolder, item);
                try {
                    const stats = await fsPromises.stat(itemPath);
                    if (stats.isDirectory()) {
                        folders.push(item);
                    }
                }
                catch {
                    continue;
                }
            }
            return folders;
        }
        catch (e) {
            log(`Could not read folders from ${notesFolder}: ${e}`);
            return [];
        }
    }
    getMetadata(filePath) {
        const metadataKey = `note_metadata_${filePath}`;
        return this._context.globalState.get(metadataKey, {});
    }
    async setMetadata(filePath, metadata) {
        const metadataKey = `note_metadata_${filePath}`;
        await this._context.globalState.update(metadataKey, metadata);
    }
    async togglePinNote(filePath) {
        const metadata = this.getMetadata(filePath);
        metadata.pinned = !metadata.pinned;
        const folder = path.basename(path.dirname(filePath));
        const projectNotesFolder = await this.getProjectNotesFolder();
        // Logik för att spara mappnamn
        if (path.dirname(filePath) === this.getDailyNotesFolder()) {
            metadata.folder = DAILY_NOTES_DISPLAY_NAME;
        }
        else if (path.dirname(filePath) === this.getGlobalNotesFolder()) {
            metadata.folder = GLOBAL_NOTES_DISPLAY_NAME;
        }
        else if (projectNotesFolder && path.dirname(filePath) !== projectNotesFolder) {
            metadata.folder = folder; // Projekt-submapp
        }
        else {
            delete metadata.folder; // Rotmapp (antingen projektets rot eller globala roten)
        }
        await this.setMetadata(filePath, metadata);
        this.refresh();
    }
    async moveNoteToFolder(filePath, folderName) {
        try {
            // Flytt kan bara ske inom projektmappen
            const notesFolder = await this.getProjectNotesFolder();
            if (!notesFolder) {
                vscode.window.showErrorMessage('Cannot move note: No active project notes folder.');
                return;
            }
            // Kontrollera om filen är global
            if (path.dirname(filePath) === this.getDailyNotesFolder() ||
                path.dirname(filePath) === this.getGlobalNotesFolder()) {
                vscode.window.showErrorMessage('Cannot move notes from/to the Global folders.');
                return;
            }
            const fileName = path.basename(filePath);
            if (folderName === '') {
                // Flytta till Projektets Rot
                const newPath = path.join(notesFolder, fileName);
                if (filePath !== newPath) {
                    await fsPromises.rename(filePath, newPath);
                    const oldMetadata = this.getMetadata(filePath);
                    await this._context.globalState.update(`note_metadata_${filePath}`, undefined);
                    delete oldMetadata.folder; // Ta bort mappinformationen
                    await this.setMetadata(newPath, oldMetadata);
                }
            }
            else {
                // Flytta till en projektmapp
                const folderPath = path.join(notesFolder, folderName);
                await fsPromises.mkdir(folderPath, { recursive: true });
                const newPath = path.join(folderPath, fileName);
                if (filePath !== newPath) {
                    await fsPromises.rename(filePath, newPath);
                    const oldMetadata = this.getMetadata(filePath);
                    await this._context.globalState.update(`note_metadata_${filePath}`, undefined);
                    oldMetadata.folder = folderName;
                    await this.setMetadata(newPath, oldMetadata);
                }
            }
            this.refresh();
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to move note: ${error instanceof Error ? error.message : 'Unknown error'}`);
            log('Move note error:', error);
        }
    }
    // FIXAT: Uppdaterad för att acceptera en bassökväg
    async createFolder(folderName, basePath) {
        try {
            // Använder basePath om det finns, annars faller tillbaka till projektmappen
            const notesFolder = basePath || await this.getProjectNotesFolder();
            if (!notesFolder) {
                vscode.window.showErrorMessage('Cannot create folder: no active notes folder.');
                return;
            }
            if (folderName === DAILY_NOTES_FOLDER_NAME || folderName === GLOBAL_NOTES_FOLDER_NAME ||
                folderName === DAILY_NOTES_DISPLAY_NAME || folderName === GLOBAL_NOTES_DISPLAY_NAME) {
                vscode.window.showErrorMessage('Cannot create folder with that name as it is reserved.');
                return;
            }
            await fsPromises.mkdir(notesFolder, { recursive: true });
            const folderPath = path.join(notesFolder, folderName);
            let folderExists = true;
            try {
                await fsPromises.access(folderPath);
            }
            catch {
                folderExists = false;
            }
            if (!folderExists) {
                await fsPromises.mkdir(folderPath, { recursive: true });
                vscode.window.showInformationMessage(`Folder '${folderName}' created successfully.`);
                this.refresh(); // Tvingar uppdatering
            }
            else {
                vscode.window.showWarningMessage('Folder already exists!');
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to create folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
            log('Create folder error:', error);
        }
    }
    async getNotes(projectNotesPath, dailyNotesPath, globalNotesPath // NY
    ) {
        const result = {
            pinned: [],
            folders: {},
            root: []
        };
        const allDeadlines = new Set();
        const { calendarTags } = getCustomTagsAndColors();
        // 1. HANTERA DAILY NOTES
        if (dailyNotesPath) {
            const dailyNotes = await this.readNotesFromFolder(dailyNotesPath, allDeadlines, [], calendarTags, DAILY_NOTES_DISPLAY_NAME);
            dailyNotes.pinned.forEach((note) => {
                if (!result.pinned.some((p) => p.filePath === note.filePath)) {
                    result.pinned.push(note);
                }
            });
            if (dailyNotes.root.length > 0) {
                result.folders[DAILY_NOTES_DISPLAY_NAME] = dailyNotes.root;
            }
        }
        // 2. HANTERA GLOBALA ANTECKNINGAR
        if (globalNotesPath) {
            const globalNotes = await this.readNotesFromFolder(globalNotesPath, allDeadlines, [], calendarTags, GLOBAL_NOTES_DISPLAY_NAME);
            globalNotes.pinned.forEach((note) => {
                if (!result.pinned.some((p) => p.filePath === note.filePath)) {
                    result.pinned.push(note);
                }
            });
            if (globalNotes.root.length > 0) {
                result.folders[GLOBAL_NOTES_DISPLAY_NAME] = globalNotes.root;
            }
        }
        // 3. HANTERA PROJEKTSPECIFIKA ANTECKNINGAR
        if (projectNotesPath) {
            const projectExists = await fsPromises.access(projectNotesPath).then(() => true).catch(() => false);
            if (projectExists) {
                // Exkludera globala mappar ifall de är kapslade (t.ex. om projektet är `~/Notes`)
                const exclude = [DAILY_NOTES_FOLDER_NAME, GLOBAL_NOTES_FOLDER_NAME];
                const projectNotes = await this.readNotesFromFolder(projectNotesPath, allDeadlines, exclude, calendarTags);
                projectNotes.pinned.forEach((note) => {
                    if (!result.pinned.some((p) => p.filePath === note.filePath)) {
                        result.pinned.push(note);
                    }
                });
                result.root.push(...projectNotes.root);
                for (const folderName in projectNotes.folders) {
                    result.folders[folderName] = (result.folders[folderName] || []).concat(projectNotes.folders[folderName]);
                }
            }
        }
        log('Sending deadlines to WebView:', Array.from(allDeadlines));
        return { ...result, deadlines: Array.from(allDeadlines) };
    }
    // Lade till defaultFolderName för att hantera Daily/Global Notes
    async readNotesFromFolder(notesFolder, allDeadlines, excludeFolders = [], calendarTags = [], defaultFolderName) {
        const result = {
            pinned: [],
            folders: {},
            root: []
        };
        let items;
        try {
            items = await fsPromises.readdir(notesFolder);
        }
        catch (e) {
            log(`Could not read notes folder: ${e}`);
            return result;
        }
        const folders = [];
        const rootFiles = [];
        for (const item of items) {
            const itemPath = path.join(notesFolder, item);
            try {
                const stats = await fsPromises.stat(itemPath);
                if (stats.isDirectory() && !excludeFolders.includes(item)) {
                    folders.push(item);
                }
                else if (stats.isFile() && item.endsWith('.md')) {
                    rootFiles.push(item);
                }
            }
            catch {
                continue;
            }
        }
        const rootFilesWithStats = await Promise.all(rootFiles.map(async (file) => {
            try {
                const stats = await fsPromises.stat(path.join(notesFolder, file));
                return { file, mtime: stats.mtime.getTime() };
            }
            catch {
                return { file, mtime: 0 };
            }
        }));
        rootFilesWithStats.sort((a, b) => b.mtime - a.mtime);
        for (const { file } of rootFilesWithStats) {
            try {
                const filePath = path.join(notesFolder, file);
                const noteData = await this.getNoteData(notesFolder, file, calendarTags);
                noteData.deadlines.forEach((d) => allDeadlines.add(d));
                const metadata = this.getMetadata(filePath);
                const note = {
                    ...noteData,
                    pinned: metadata.pinned || false,
                    folder: defaultFolderName || metadata.folder
                };
                if (note.pinned) {
                    result.pinned.push(note);
                }
                else {
                    result.root.push(note);
                }
            }
            catch (e) {
                log(`Could not read file data from ${file}: ${e}`);
            }
        }
        for (const folder of folders) {
            const folderPath = path.join(notesFolder, folder);
            let folderFiles = [];
            try {
                const allFiles = await fsPromises.readdir(folderPath);
                folderFiles = allFiles.filter(file => file.endsWith('.md'));
                const filesWithStats = await Promise.all(folderFiles.map(async (file) => {
                    try {
                        const stats = await fsPromises.stat(path.join(folderPath, file));
                        return { file, mtime: stats.mtime.getTime() };
                    }
                    catch {
                        return { file, mtime: 0 };
                    }
                }));
                filesWithStats.sort((a, b) => b.mtime - a.mtime);
                folderFiles = filesWithStats.map(f => f.file);
            }
            catch (e) {
                log(`Could not read folder ${folderPath}: ${e}`);
            }
            const folderNotes = [];
            for (const file of folderFiles) {
                try {
                    const filePath = path.join(folderPath, file);
                    const noteData = await this.getNoteData(folderPath, file, calendarTags);
                    noteData.deadlines.forEach((d) => allDeadlines.add(d));
                    const metadata = this.getMetadata(filePath);
                    const note = { ...noteData, folder: folder, pinned: metadata.pinned || false };
                    if (note.pinned) {
                        result.pinned.push(note); // Lägg till i huvudlistan för pinned
                    }
                    else {
                        folderNotes.push(note);
                    }
                }
                catch (e) {
                    log(`Could not read file data from ${file} i folder ${folder}: ${e}`);
                }
            }
            // FIXAT: Lägger till mappen i listan även om den är tom.
            result.folders[folder] = folderNotes;
        }
        return result;
    }
    async getNoteData(folderPath, file, calendarTags = []) {
        const filePath = path.join(folderPath, file);
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const isTodoList = content.includes('- [ ]') || content.includes('- [x]');
        const fileName = path.basename(file, '.md');
        const todos = isTodoList ? await this.getTodoItems(filePath) : [];
        const tagsConfig = getCustomTagsAndColors();
        const allTags = tagsConfig.tags;
        const sidebarTags = tagsConfig.sidebarTags;
        const tagRegex = new RegExp(`#(${allTags.join('|')})\\b`, 'gi');
        const calendarTagRegex = new RegExp(`#(${calendarTags.join('|')})\\s*\\(\\s*(\\d{4}-\\d{2}-\\d{2})\\s*\\)`, 'gi');
        const foundTags = [];
        const deadlines = [];
        let tagMatch;
        while ((tagMatch = tagRegex.exec(content)) !== null) {
            const tag = tagMatch[1].toUpperCase();
            if (sidebarTags.includes(tag) && !foundTags.some(t => t.tag === tag)) {
                foundTags.push({
                    tag: tag,
                    color: tagsConfig.colors[tag] || '#FFFFFF'
                });
            }
        }
        let deadlineMatch;
        while ((deadlineMatch = calendarTagRegex.exec(content)) !== null) {
            deadlines.push(deadlineMatch[2]);
        }
        return {
            title: fileName,
            filePath: filePath,
            isTodoList: isTodoList,
            todos: todos,
            deadlines: deadlines,
            activeTags: foundTags
        };
    }
    async getTodoItems(filePath) {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const todoItems = [];
        lines.forEach((line, index) => {
            const todoMatch = line.match(/^- \[([ x])\] (.+)$/);
            if (todoMatch) {
                const isChecked = todoMatch[1] === 'x';
                const text = todoMatch[2];
                todoItems.push({
                    text: text,
                    isChecked: isChecked,
                    lineNumber: index
                });
            }
        });
        return todoItems;
    }
    // ÄNDRAT: Heter nu getProjectNotesFolder och har inte längre en global fallback
    async getProjectNotesFolder() {
        const config = vscode.workspace.getConfiguration('quickNotes');
        let storageFolder = config.get('notesFolder');
        if (storageFolder) {
            if (storageFolder.startsWith('~/')) {
                storageFolder = path.join(os.homedir(), storageFolder.substring(2));
            }
            if (path.isAbsolute(storageFolder)) {
                try {
                    await fsPromises.mkdir(storageFolder, { recursive: true });
                }
                catch (error) {
                    log(`Could not create notes folder: ${error}`);
                }
                return storageFolder;
            }
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const projectNotesPath = path.join(workspaceFolder.uri.fsPath, storageFolder);
                try {
                    await fsPromises.mkdir(projectNotesPath, { recursive: true });
                }
                catch (error) {
                    log(`Could not create project notes folder: ${error}`);
                }
                return projectNotesPath;
            }
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        // Standardbeteendet är nu BARA projekt-specifikt
        if (workspaceFolder) {
            const notesRoot = path.join(workspaceFolder.uri.fsPath, 'quick-notes');
            try {
                await fsPromises.mkdir(notesRoot, { recursive: true });
            }
            catch (error) {
                log(`Could not create default notes folder: ${error}`);
            }
            return notesRoot;
        }
        // Om ingen mapp är öppen returneras ingenting
        return undefined;
    }
    getDailyNotesFolder() {
        const dailyRoot = path.join(os.homedir(), 'Notes', DAILY_NOTES_FOLDER_NAME);
        try {
            if (!fs.existsSync(dailyRoot)) {
                fs.mkdirSync(dailyRoot, { recursive: true });
            }
        }
        catch (error) {
            log(`Could not create daily notes folder: ${error}`);
        }
        return dailyRoot;
    }
    // NY FUNKTION: Hämtar den andra globala mappen
    getGlobalNotesFolder() {
        const globalRoot = path.join(os.homedir(), 'Notes', GLOBAL_NOTES_FOLDER_NAME);
        try {
            if (!fs.existsSync(globalRoot)) {
                fs.mkdirSync(globalRoot, { recursive: true });
            }
        }
        catch (error) {
            log(`Could not create global notes folder: ${error}`);
        }
        return globalRoot;
    }
    async createNote(title, isTodoList, folderName, basePath) {
        try {
            // Använder den medskickade bassökvägen (antingen global eller projekt)
            const notesFolder = basePath || await this.getProjectNotesFolder();
            if (!notesFolder) {
                vscode.window.showErrorMessage('Cannot create note: no notes folder is configured.');
                return;
            }
            await fsPromises.mkdir(notesFolder, { recursive: true });
            // Om folderName är definierat (t.ex. en submapp)
            const targetFolder = folderName ? path.join(notesFolder, folderName) : notesFolder;
            if (folderName) {
                await fsPromises.mkdir(targetFolder, { recursive: true });
            }
            const fileName = `${title}.md`;
            const filePath = path.join(targetFolder, fileName);
            let fileExists = true;
            try {
                await fsPromises.access(filePath);
            }
            catch {
                fileExists = false;
            }
            if (!fileExists) {
                log(`File ${fileName} does not exist. Creating it in ${targetFolder}.`);
                let content = `# ${title}\n\n`;
                if (isTodoList) {
                    content += `- [ ] First item\n- [ ] Second item\n- [ ] Third item\n`;
                }
                else {
                    content += `Write your notes here...\n`;
                }
                await fsPromises.writeFile(filePath, content, 'utf-8');
                if (folderName) {
                    const metadata = { folder: folderName };
                    await this.setMetadata(filePath, metadata);
                }
            }
            else {
                log(`File ${fileName} already exists. Opening it instead of overwriting.`);
            }
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc, { preview: false });
            // FIXAT: Tvinga en uppdatering av sidofältet (eftersom fileWatcher missar globala filer)
            this.refresh();
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to create note: ${error instanceof Error ? error.message : 'Unknown error'}`);
            log('Create note error:', error);
        }
    }
    async createNoteFromDate(dateString) {
        try {
            const date = new Date(dateString + 'T00:00:00');
            const title = `Daily note ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const dailyNotesFolder = this.getDailyNotesFolder();
            const filePath = path.join(dailyNotesFolder, `${title}.md`);
            let fileExists = true;
            try {
                await fsPromises.access(filePath);
            }
            catch {
                fileExists = false;
            }
            if (!fileExists) {
                log(`Creating daily note: ${filePath}`);
                let content = `# ${title}\n\n`;
                content += `Write your notes here...\n`;
                await fsPromises.writeFile(filePath, content, 'utf-8');
            }
            else {
                log(`Opening existing daily note: ${filePath}`);
            }
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc, { preview: false });
            // FIXAT: Tvinga en uppdatering av sidofältet (eftersom fileWatcher missar globala filer)
            this.refresh();
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to create daily note: ${error instanceof Error ? error.message : 'Unknown error'}`);
            log('Create daily note error:', error);
        }
    }
    openNote(filePath) {
        vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
    }
    async deleteNote(filePath, title) {
        const confirm = await vscode.window.showWarningMessage(`Delete "${title}"?`, 'Yes', 'No');
        if (confirm === 'Yes') {
            try {
                await fsPromises.unlink(filePath);
                await this._context.globalState.update(`note_metadata_${filePath}`, undefined);
                this.refresh();
            }
            catch (error) {
                vscode.window.showErrorMessage(`Failed to delete note: ${error instanceof Error ? error.message : 'Unknown error'}`);
                log('Delete note error:', error);
            }
        }
    }
    async toggleTodo(filePath, lineNumber) {
        try {
            const content = await fsPromises.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            if (lineNumber < lines.length) {
                const line = lines[lineNumber];
                if (line.includes('[ ]')) {
                    lines[lineNumber] = line.replace('[ ]', '[x]');
                }
                else if (line.includes('[x]')) {
                    lines[lineNumber] = line.replace('[x]', '[ ]');
                }
                await fsPromises.writeFile(filePath, lines.join('\n'), 'utf-8');
                this.refresh();
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to toggle todo: ${error instanceof Error ? error.message : 'Unknown error'}`);
            log('Toggle todo error:', error);
        }
    }
    _getHtmlForWebview(webview) {
        // Observera att vi escapear backticksen (`), vilket gör att vi måste escapea
        // alla backticks (som används för Template Literals) inuti med en backslash (\).
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Quick Notes</title>
            <style>
                body {
                    padding: 0;
                    margin: 0;
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }
                
                #notes-container {
                    padding: 10px;
                    padding-bottom: 20px;
                    flex: 1;
                    overflow-y: auto;
                }
                
                .section-header {
                    font-size: 11px;
                    font-weight: bold;
                    text-transform: uppercase;
                    opacity: 0.6;
                    margin-top: 16px;
                    margin-bottom: 8px;
                    padding-left: 4px;
                }
                
                .section-header:first-child {
                    margin-top: 0;
                }
                
                .folder-item {
                    margin-bottom: 8px;
                }
                
                .folder-header {
                    display: flex;
                    align-items: center;
                    padding: 8px;
                    background-color: var(--vscode-list-inactiveSelectionBackground);
                    border-radius: 4px;
                    cursor: pointer;
                    gap: 6px;
                }
                
                .folder-header:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .folder-arrow {
                    font-size: 12px;
                    transition: transform 0.2s;
                }
                
                .folder-arrow.collapsed {
                    transform: rotate(-90deg);
                }
                
                .folder-icon {
                    font-size: 16px;
                }
                
                .folder-name {
                    font-weight: bold;
                    flex: 1;
                }
                
                /* Justering för filer inuti mappar */
                .folder-contents {
                    margin-left: 10px; 
                    margin-top: 4px;
                    padding-left: 10px; 
                    border-left: 1px solid var(--vscode-panel-border); 
                }
                
                .folder-contents.collapsed {
                    display: none;
                }
                
                .note-item {
                    margin-bottom: 4px; 
                    padding: 6px 8px;
                    background-color: var(--vscode-list-inactiveSelectionBackground);
                    border-radius: 4px;
                    cursor: pointer;
                    position: relative;
                }

                /* Stil för filer som är barn till en mapp (som inte är Daily Notes) */
                .folder-contents > .note-item.folder-content-item {
                    background-color: transparent;
                    border: 1px solid transparent;
                    margin-bottom: 2px;
                    border-radius: 0;
                    padding: 4px 0px;
                }
                
                .note-item.root-content-item {
                    /* Standard rot-stil */
                }

                .note-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .note-item:hover .note-actions {
                    opacity: 1;
                }
                
                .note-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 6px;
                }
                
                .note-title {
                    font-weight: normal; 
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex: 1;
                    font-size: 13px;
                }
                
                .note-tags {
                    display: flex;
                    gap: 4px;
                    flex-wrap: wrap;
                }
                
                .note-tag {
                    font-size: 10px;
                    font-weight: bold;
                    padding: 1px 4px;
                    border-radius: 3px;
                    background-color: var(--vscode-editorGroupHeader-tabsBackground);
                    color: var(--vscode-editor-foreground);
                    opacity: 0.8;
                }
                
                .note-actions {
                    display: flex;
                    gap: 4px;
                    opacity: 0;
                    transition: opacity 0.2s;
                }
                
                .pin-btn, .delete-btn {
                    background: none;
                    border: none;
                    color: var(--vscode-foreground);
                    cursor: pointer;
                    padding: 2px 6px;
                    opacity: 0.6;
                    font-size: 14px;
                }
                
                .pin-btn:hover, .delete-btn:hover {
                    opacity: 1;
                }
                
                .pin-btn.pinned {
                    opacity: 1;
                    color: var(--vscode-terminal-ansiYellow); 
                }
                
                .delete-btn:hover {
                    color: var(--vscode-errorForeground);
                }
                
                .collapse-arrow {
                    font-size: 12px;
                    transition: transform 0.2s;
                    cursor: pointer;
                    user-select: none;
                }
                
                .collapse-arrow.collapsed {
                    transform: rotate(-90deg);
                }
                
                .note-icon {
                    font-size: 16px;
                    /* Vi låter JS-koden sätta ikonen */
                }
                
                .todo-list {
                    margin-top: 4px;
                    padding-left: 20px;
                    max-height: 150px; 
                    overflow-y: auto; 
                }
                
                .todo-list.collapsed {
                    display: none;
                }
                
                .todo-item {
                    display: flex;
                    align-items: flex-start; 
                    gap: 6px;
                    padding: 2px 0;
                    cursor: pointer;
                    font-size: 13px;
                }
                
                .todo-item:hover {
                    opacity: 0.8;
                }
                
                .todo-checkbox {
                    width: 14px;
                    height: 14px;
                    border: 1px solid var(--vscode-foreground);
                    border-radius: 3px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    margin-top: 2px; 
                }
                
                .todo-checked {
                    background-color: var(--vscode-button-background);
                    border-color: var(--vscode-button-background);
                }
                
                .todo-checked::after {
                    content: '✓';
                    color: var(--vscode-button-foreground);
                    font-size: 11px;
                }
                
                .todo-text {
                    flex: 1;
                }
                
                .todo-text.checked {
                    text-decoration: line-through;
                    opacity: 0.6;
                }
                
                /* Context Menu */
                .context-menu {
                    position: fixed;
                    background-color: var(--vscode-menu-background);
                    border: 1px solid var(--vscode-menu-border);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                    z-index: 1000;
                    min-width: 150px;
                    padding: 4px 0;
                    display: none;
                }
                
                .context-menu-item {
                    padding: 6px 12px;
                    cursor: pointer;
                    font-size: 13px;
                }
                
                .context-menu-item:hover {
                    background-color: var(--vscode-menu-selectionBackground);
                    color: var(--vscode-menu-selectionForeground);
                }
                
                .context-menu-separator {
                    height: 1px;
                    background-color: var(--vscode-menu-separatorBackground);
                    margin: 4px 0;
                }
                
                /* Calendar Styles */
                #calendar-container {
                    border-top: 1px solid var(--vscode-panel-border);
                    padding: 10px;
                    background-color: var(--vscode-sideBar-background);
                    flex-shrink: 0;
                }
                
                .calendar-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                
                .calendar-toggle {
                    background: none;
                    border: none;
                    color: var(--vscode-foreground);
                    cursor: pointer;
                    padding: 4px 8px;
                    font-size: 14px;
                    opacity: 0.7;
                }
                
                .calendar-toggle:hover {
                    opacity: 1;
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                #calendar-content.hidden {
                    display: none;
                }
                
                #calendar-container.collapsed {
                    padding: 5px 10px;
                }
                
                .show-calendar-btn {
                    width: 100%;
                    padding: 8px;
                    background: none;
                    border: none;
                    color: var(--vscode-foreground);
                    cursor: pointer;
                    text-align: center;
                    opacity: 0.7;
                    font-size: 13px;
                }
                
                .show-calendar-btn:hover {
                    opacity: 1;
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .calendar-nav {
                    background: none;
                    border: none;
                    color: var(--vscode-foreground);
                    cursor: pointer;
                    padding: 4px 8px;
                    font-size: 16px;
                }
                
                .calendar-nav:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .calendar-month {
                    font-weight: bold;
                    font-size: 14px;
                }
                
                .calendar-grid {
                    display: grid;
                    grid-template-columns: repeat(7, 1fr);
                    gap: 2px;
                }
                
                .calendar-day-header {
                    text-align: center;
                    font-size: 11px;
                    font-weight: bold;
                    padding: 4px 0;
                    opacity: 0.7;
                }
                
                .calendar-day {
                    aspect-ratio: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    cursor: pointer;
                    border-radius: 3px;
                    transition: all 0.2s;
                }
                
                .calendar-day:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .calendar-day.other-month {
                    opacity: 0.3;
                }
                
                .calendar-day.today {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    font-weight: bold;
                }
                
                .calendar-day.selected {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                
                .calendar-day.deadline {
                    background-color: var(--vscode-errorForeground);
                    color: var(--vscode-button-foreground) !important;
                    font-weight: bold;
                    border-radius: 50%;
                }
                
                .calendar-day.deadline.today {
                    background-color: var(--vscode-errorForeground);
                }

            </style>
        </head>
        <body>
            <div id="notes-container"></div>
            
            <div id="calendar-container">
                <button class="show-calendar-btn" id="show-calendar-btn" style="display: none;">
                    📅 Show Calendar
                </button>
                <div id="calendar-content">
                    <div class="calendar-header">
                        <button class="calendar-nav" id="prev-month">‹</button>
                        <span class="calendar-month" id="current-month"></span>
                        <button class="calendar-nav" id="next-month">›</button>
                        <button class="calendar-toggle" id="hide-calendar" title="Hide calendar">✕</button>
                    </div>
                    <div class="calendar-grid" id="calendar"></div>
                </div>
            </div>
            
            <div id="context-menu" class="context-menu"></div>

            <script>
                (function() {
                    const vscode = acquireVsCodeApi();
                    let currentNotes = { pinned: [], folders: {}, root: [] }; 
                    let deadlineDates = [];
                    let currentDate = new Date();
                    let selectedDate = null;
                    let contextMenuTarget = null;
                    let availableFolders = [];
                    
                    let collapseState = {};
                    let currentTagColors = {}; 

                    vscode.postMessage({ type: 'requestNotes' });
                    vscode.postMessage({ type: 'getFolders' });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'notesUpdate') {
                            const notesData = message.notesData; 
                            currentNotes = notesData; 
                            deadlineDates = notesData.deadlines || []; 
                            currentTagColors = message.tagColors || {};
                            
                            renderNotes();
                            renderCalendar();
                        } else if (message.type === 'foldersUpdate') {
                            availableFolders = message.folders;
                        }
                    });

                    function isColorDark(hexColor) {
                        if (!hexColor) return false;
                        hexColor = hexColor.replace('#', '');
                        if (hexColor.length === 3) {
                            hexColor = hexColor.split('').map(char => char + char).join('');
                        }
                        if (hexColor.length === 8) {
                            hexColor = hexColor.substring(0, 6);
                        }
                        const r = parseInt(hexColor.substring(0, 2), 16);
                        const g = parseInt(hexColor.substring(2, 4), 16);
                        const b = parseInt(hexColor.substring(4, 6), 16);
                        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                        return brightness < 150;
                    };

                    function renderNotes() {
                        const container = document.getElementById('notes-container');
                        container.innerHTML = '';

                        const hasNotes = currentNotes.pinned.length > 0 || 
                                                 Object.keys(currentNotes.folders).length > 0 || 
                                                 currentNotes.root.length > 0;

                        if (!hasNotes) {
                            container.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.6;">No notes yet. Create one using the buttons above!</div>';
                            return;
                        }
                        
                        // 1. PINNED NOTES
                        if (currentNotes.pinned.length > 0) {
                            const pinnedHeader = document.createElement('div');
                            pinnedHeader.className = 'section-header';
                            pinnedHeader.textContent = 'Pinned';
                            container.appendChild(pinnedHeader);

                            currentNotes.pinned.sort((a, b) => a.title.localeCompare(b.title));

                            currentNotes.pinned.forEach(note => {
                                container.appendChild(createNoteElement(note, true, note.folder)); 
                            });
                        }

                        // 2. FOLDERS
                        if (Object.keys(currentNotes.folders).length > 0) {
                            const foldersHeader = document.createElement('div');
                            foldersHeader.className = 'section-header';
                            foldersHeader.textContent = 'Folders';
                            container.appendChild(foldersHeader);

                            // KORRIGERING: Sorterar mappar, men Daily Notes och Global Notes ska ALLTID vara först.
                            const folderNames = Object.keys(currentNotes.folders).sort((a, b) => {
                                if (a === 'Daily Notes') return -1; // Daily Notes först
                                if (b === 'Daily Notes') return 1;
                                if (a === 'Global Notes') return -1; // Global Notes näst först
                                if (b === 'Global Notes') return 1;
                                return a.localeCompare(b); // Annars alfabetiskt
                            });

                            folderNames.forEach(folderName => {
                                const folderDiv = document.createElement('div');
                                folderDiv.className = 'folder-item';

                                const folderHeaderDiv = document.createElement('div');
                                folderHeaderDiv.className = 'folder-header';

                                const arrow = document.createElement('span');
                                arrow.className = 'folder-arrow';
                                arrow.textContent = '▼';

                                const icon = document.createElement('span');
                                icon.className = 'folder-icon';
                                // Ikoner anpassade efter mappen
                                if (folderName === 'Daily Notes') {
                                    icon.textContent = '📅';
                                } else if (folderName === 'Global Notes') {
                                    icon.textContent = '🌍'; // Glob-ikon
                                } else {
                                    icon.textContent = '📁'; 
                                }

                                const name = document.createElement('span');
                                name.className = 'folder-name';
                                name.textContent = folderName;

                                folderHeaderDiv.appendChild(arrow);
                                folderHeaderDiv.appendChild(icon);
                                folderHeaderDiv.appendChild(name);

                                const folderContents = document.createElement('div');
                                folderContents.className = 'folder-contents';
                                
                                if (collapseState[folderName] === 'collapsed') {
                                    arrow.classList.add('collapsed');
                                    folderContents.classList.add('collapsed');
                                }

                                currentNotes.folders[folderName].forEach(note => {
                                    // Filerna inuti en mapp ska ha mapp-stil
                                    folderContents.appendChild(createNoteElement(note, note.pinned, folderName));
                                });

                                folderHeaderDiv.onclick = () => {
                                    const isCollapsed = arrow.classList.toggle('collapsed');
                                    folderContents.classList.toggle('collapsed');
                                    collapseState[folderName] = isCollapsed ? 'collapsed' : 'expanded';
                                };

                                folderDiv.appendChild(folderHeaderDiv);
                                folderDiv.appendChild(folderContents);
                                container.appendChild(folderDiv);
                            });
                        }

                        // 3. ROOT NOTES (Dessa är nu bara Projektets rotfiler)
                        if (currentNotes.root.length > 0) {
                            const notesHeader = document.createElement('div');
                            notesHeader.className = 'section-header';
                            notesHeader.textContent = 'Project Root Notes'; 
                            container.appendChild(notesHeader);

                            currentNotes.root.forEach(note => {
                                // Rotfiler ska ha standardstil
                                container.appendChild(createNoteElement(note, false));
                            });
                        }
                    }

                    function createNoteElement(note, isPinned, folderName) { 
                        const noteDiv = document.createElement('div');
                        
                        // KORRIGERING: Fastställer klassen baserat på plats (Globala mappar är vanliga mappar)
                        if (folderName) {
                            // Fil inuti en mapp (Daily, Global, eller Projektmapp)
                             noteDiv.className = 'note-item folder-content-item'; 
                        } else {
                            // Rotfil (Projektets rot)
                             noteDiv.className = 'note-item root-content-item';
                        }


                        const headerDiv = document.createElement('div');
                        headerDiv.className = 'note-header';
                        
                        const titleDiv = document.createElement('div');
                        titleDiv.className = 'note-title';
                        
                        let todoListDiv;

                        if (note.isTodoList && note.todos.length > 0) {
                            const arrow = document.createElement('span');
                            arrow.className = 'collapse-arrow';
                            arrow.textContent = '▼';
                            arrow.onclick = (e) => {
                                e.stopPropagation();
                                const isCollapsed = arrow.classList.toggle('collapsed');
                                if (todoListDiv) {
                                    todoListDiv.classList.toggle('collapsed');
                                }
                                collapseState[note.filePath] = isCollapsed ? 'collapsed' : 'expanded';
                            };
                            titleDiv.appendChild(arrow);
                        }
                        
                        // FIXAT: Återställer till Unicode-ikoner som Webview kan rendera som text.
                        const iconSpan = document.createElement('span');
                        iconSpan.className = 'note-icon';
                        
                        if (note.isTodoList) {
                            iconSpan.textContent = '📋'; // Clipboard (för TODO)
                        } else {
                            iconSpan.textContent = '📝'; // Penna (för Note)
                        }
                        
                        titleDiv.appendChild(iconSpan);
                        
                        const titleSpan = document.createElement('span');
                        titleSpan.textContent = note.title;
                        titleDiv.appendChild(titleSpan);
                        
                        titleDiv.onclick = (e) => {
                            if (!e.target.classList.contains('collapse-arrow')) {
                                vscode.postMessage({
                                    type: 'openNote',
                                    filePath: note.filePath
                                });
                            }
                        };
                        
                        const tagContainer = document.createElement('div');
                        tagContainer.className = 'note-tags';
                        
                        if (note.activeTags && note.activeTags.length > 0) {
                            note.activeTags.forEach(tagInfo => {
                                const tagSpan = document.createElement('span');
                                tagSpan.className = 'note-tag';
                                // Escapar backticken för att undvika TS-kompilatorfel
                                tagSpan.textContent = \`#\$\{tagInfo.tag\}\`; 
                                tagSpan.style.backgroundColor = tagInfo.color;
                                if (isColorDark(tagInfo.color)) {
                                    tagSpan.style.color = '#FFFFFF'; 
                                }
                                tagContainer.appendChild(tagSpan);
                            });
                        }

                        noteDiv.oncontextmenu = (e) => {
                            e.preventDefault();
                            showContextMenu(e, note);
                        };
                        
                        const actionsDiv = document.createElement('div');
                        actionsDiv.className = 'note-actions';
                        
                        const pinBtn = document.createElement('button');
                        pinBtn.className = 'pin-btn' + (isPinned ? ' pinned' : '');
                        pinBtn.innerHTML = '📌';
                        pinBtn.title = isPinned ? 'Unpin note' : 'Pin note';
                        pinBtn.onclick = (e) => {
                            e.stopPropagation();
                            vscode.postMessage({
                                type: 'pinNote',
                                filePath: note.filePath
                            });
                        };
                        
                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = 'delete-btn';
                        deleteBtn.innerHTML = '🗑';
                        deleteBtn.title = 'Delete note';
                        deleteBtn.onclick = (e) => {
                            e.stopPropagation();
                            vscode.postMessage({
                                type: 'deleteNote',
                                filePath: note.filePath,
                                title: note.title
                            });
                        };
                        
                        actionsDiv.appendChild(pinBtn);
                        headerDiv.appendChild(titleDiv);
                        headerDiv.appendChild(tagContainer);
                        headerDiv.appendChild(actionsDiv);
                        noteDiv.appendChild(headerDiv);
                        
                        // Lägger till Delete-knappen sist för visuell separation (ej inuti actionsDiv)
                        actionsDiv.appendChild(deleteBtn);
                        
                        if (note.isTodoList && note.todos.length > 0) {
                            todoListDiv = document.createElement('div');
                            todoListDiv.className = 'todo-list';
                            
                            if (collapseState[note.filePath] === 'collapsed') {
                                todoListDiv.classList.add('collapsed');
                                const arrow = titleDiv.querySelector('.collapse-arrow');
                                if (arrow) {
                                    arrow.classList.add('collapsed');
                                }
                            }

                            note.todos.forEach(todo => {
                                const todoDiv = document.createElement('div');
                                todoDiv.className = 'todo-item';
                                todoDiv.onclick = () => {
                                    vscode.postMessage({
                                        type: 'toggleTodo',
                                        filePath: note.filePath,
                                        lineNumber: todo.lineNumber
                                    });
                                };
                                
                                const checkbox = document.createElement('div');
                                checkbox.className = 'todo-checkbox' + (todo.isChecked ? ' todo-checked' : '');
                                
                                const text = document.createElement('span');
                                text.className = 'todo-text' + (todo.isChecked ? ' checked' : '');
                                text.textContent = todo.text;
                                
                                todoDiv.appendChild(checkbox);
                                todoDiv.appendChild(text);
                                todoListDiv.appendChild(todoDiv);
                            });
                            
                            noteDiv.appendChild(todoListDiv);
                        }
                        
                        return noteDiv;
                    }

                    function showContextMenu(event, note) {
                        const menu = document.getElementById('context-menu');
                        contextMenuTarget = note;
                        
                        menu.innerHTML = '';
                        
                        const openItem = document.createElement('div');
                        openItem.className = 'context-menu-item';
                        openItem.textContent = '📝 Open Note';
                        openItem.onclick = () => {
                            vscode.postMessage({ type: 'openNote', filePath: note.filePath });
                            hideContextMenu();
                        };
                        menu.appendChild(openItem);

                        menu.appendChild(document.createElement('div')).className = 'context-menu-separator';
                        
                        const pinItem = document.createElement('div');
                        pinItem.className = 'context-menu-item';
                        pinItem.textContent = note.pinned ? '📌 Unpin Note' : '📌 Pin Note';
                        pinItem.onclick = () => {
                            vscode.postMessage({
                                type: 'pinNote',
                                filePath: note.filePath
                            });
                            hideContextMenu();
                        };
                        menu.appendChild(pinItem);
                        
                        menu.appendChild(document.createElement('div')).className = 'context-menu-separator';
                        
                        // Move to Root
                        // Visa endast om anteckningen INTE är i roten och INTE är i Daily Notes mappen
                        if (note.folder && note.folder !== 'Daily Notes' && note.folder !== 'Global Notes') { 
                            const moveToRootItem = document.createElement('div');
                            moveToRootItem.className = 'context-menu-item';
                            moveToRootItem.textContent = '📂 Move to Project Root ( / )';
                            moveToRootItem.onclick = () => {
                                vscode.postMessage({
                                    type: 'moveToFolder',
                                    filePath: note.filePath,
                                    folderName: ''
                                });
                                hideContextMenu();
                            };
                            menu.appendChild(moveToRootItem);
                            menu.appendChild(document.createElement('div')).className = 'context-menu-separator';
                        }
                            
                        // Move to Folder submenu
                        // Kan inte flytta till eller från Daily Notes
                        const foldersToMoveTo = availableFolders.filter(folder => folder !== note.folder);

                        if (foldersToMoveTo.length > 0 && note.folder !== 'Daily Notes' && note.folder !== 'Global Notes') {
                            const moveHeader = document.createElement('div');
                            moveHeader.className = 'context-menu-item';
                            moveHeader.textContent = '— Move to Project Folder —';
                            moveHeader.style.fontWeight = 'bold';
                            moveHeader.style.opacity = '0.7';
                            moveHeader.style.cursor = 'default';
                            menu.appendChild(moveHeader);
                            
                            foldersToMoveTo.forEach(folder => {
                                const folderItem = document.createElement('div');
                                folderItem.className = 'context-menu-item';
                                folderItem.textContent = '📁 ' + folder;
                                folderItem.onclick = () => {
                                    vscode.postMessage({
                                        type: 'moveToFolder',
                                        filePath: note.filePath,
                                        folderName: folder
                                    });
                                    hideContextMenu();
                                };
                                menu.appendChild(folderItem);
                            });
                            menu.appendChild(document.createElement('div')).className = 'context-menu-separator';
                        }
                        
                        // Delete
                        const deleteItem = document.createElement('div');
                        deleteItem.className = 'context-menu-item';
                        deleteItem.textContent = '🗑 Delete Note';
                        deleteItem.onclick = (e) => {
                             vscode.postMessage({
                                type: 'deleteNote',
                                filePath: note.filePath,
                                title: note.title
                            });
                            hideContextMenu();
                        };
                        menu.appendChild(deleteItem);


                        menu.style.display = 'block';
                        menu.style.left = event.pageX + 'px';
                        menu.style.top = event.pageY + 'px';
                    }

                    function hideContextMenu() {
                        const menu = document.getElementById('context-menu');
                        menu.style.display = 'none';
                        contextMenuTarget = null;
                    }

                    document.addEventListener('click', hideContextMenu);

                    // Kalender-funktioner
                    function renderCalendar() {
                        const calendar = document.getElementById('calendar');
                        const monthLabel = document.getElementById('current-month');
                        
                        const year = currentDate.getFullYear();
                        const month = currentDate.getMonth();
                        
                        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                                             'July', 'August', 'September', 'October', 'November', 'December'];
                        // FIXAT: Escapar backticken för att undvika TS-kompilatorfel
                        monthLabel.textContent = \`\$\{monthNames[month]\} \$\{year\}\`; 

                        calendar.innerHTML = '';
                        
                        const dayHeaders = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
                        dayHeaders.forEach(day => {
                            const header = document.createElement('div');
                            header.className = 'calendar-day-header';
                            header.textContent = day;
                            calendar.appendChild(header);
                        });
                        
                        const firstDay = new Date(year, month, 1).getDay();
                        const daysInMonth = new Date(year, month + 1, 0).getDate();
                        const daysInPrevMonth = new Date(year, month, 0).getDate();
                        
                        const today = new Date();
                        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
                        
                        for (let i = firstDay - 1; i >= 0; i--) {
                            const day = document.createElement('div');
                            day.className = 'calendar-day other-month';
                            day.textContent = daysInPrevMonth - i;
                            calendar.appendChild(day);
                        }
                        
                        for (let day = 1; day <= daysInMonth; day++) {
                            const dayDiv = document.createElement('div');
                            dayDiv.className = 'calendar-day';
                            dayDiv.textContent = day;
                            
                            const monthString = String(month + 1).padStart(2, '0');
                            const dayString = String(day).padStart(2, '0');
                            // FIXAT: Escapar backticken för att undvika TS-kompilatorfel
                            const dateString = \`\$\{year\}-\$\{monthString\}-\$\{dayString\}\`; 

                            if (deadlineDates.includes(dateString)) {
                                dayDiv.classList.add('deadline');
                            }
                            
                            const dayDate = new Date(dateString + 'T00:00:00');
                            
                            if (isCurrentMonth && day === today.getDate()) {
                                dayDiv.classList.add('today');
                            }
                            
                            if (selectedDate && 
                                selectedDate.getFullYear() === year && 
                                selectedDate.getMonth() === month && 
                                selectedDate.getDate() === day) {
                                dayDiv.classList.add('selected');
                            }
                            
                            dayDiv.onclick = () => {
                                selectedDate = dayDate;
                                vscode.postMessage({
                                    type: 'dateClicked',
                                    date: dateString
                                });
                                renderCalendar();
                            };
                            
                            calendar.appendChild(dayDiv);
                        }
                        
                        const totalCells = firstDay + daysInMonth;
                        const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
                        
                        for (let day = 1; day <= remainingCells; day++) {
                            const dayDiv = document.createElement('div');
                            dayDiv.className = 'calendar-day other-month';
                            dayDiv.textContent = day;
                            calendar.appendChild(dayDiv);
                        }
                    }
                    
                    document.getElementById('prev-month').onclick = () => {
                        currentDate.setMonth(currentDate.getMonth() - 1);
                        renderCalendar();
                    };
                    
                    document.getElementById('next-month').onclick = () => {
                        currentDate.setMonth(currentDate.getMonth() + 1);
                        renderCalendar();
                    };
                    
                    document.getElementById('hide-calendar').onclick = () => {
                        document.getElementById('calendar-content').classList.add('hidden');
                        document.getElementById('show-calendar-btn').style.display = 'block';
                        document.getElementById('calendar-container').classList.add('collapsed');
                    };
                    
                    document.getElementById('show-calendar-btn').onclick = () => {
                        document.getElementById('calendar-content').classList.remove('hidden');
                        document.getElementById('show-calendar-btn').style.display = 'none';
                        document.getElementById('calendar-container').classList.remove('collapsed');
                    };
                    
                    renderCalendar();
                }());
            </script>
        </body>
        </html>`;
    }
}
function deactivate() {
    log('Quick Notes extension deactivated');
}
//# sourceMappingURL=extension.js.map