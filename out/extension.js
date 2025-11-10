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
const fs = __importStar(require("fs")); // Vi behåller 'fs' för 'existsSync'
const fsPromises = __importStar(require("fs/promises")); // --- NY --- Importerar Asynkrona versioner
const path = __importStar(require("path"));
const os = __importStar(require("os"));
let notesProvider;
const DEBUG = false; // Sätt till true för att se loggar i konsolen
function log(message, ...args) {
    if (DEBUG) {
        console.log(`[QuickNotes] ${message}`, ...args);
    }
}
// --- FIX --- Konstanter för att undvika sträng-buggar
const DAILY_NOTES_FOLDER_NAME = "Daily-notes";
const DAILY_NOTES_DISPLAY_NAME = "Daily Notes (Global)";
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
        if (e.affectsConfiguration('quickNotes.notesFolder')) {
            log("Setting 'notesFolder' changed. Updating...");
            notesProvider.refresh();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('quickNotes.newNote', async () => {
        const notesFolder = await notesProvider.getNotesFolder(); // --- FIX --- (await)
        if (!notesFolder) {
            return;
        }
        const allFolders = await notesProvider.getFolders(notesFolder);
        const quickPickItems = [
            { label: "$(file-directory) Spara i roten ( / )", folderName: undefined },
            ...allFolders.map(f => ({ label: `$(folder) ${f}`, folderName: f }))
        ];
        const selection = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: "Välj en mapp att spara anteckningen i"
        });
        if (!selection) {
            return;
        }
        const selectedFolder = selection.folderName;
        const title = await vscode.window.showInputBox({
            prompt: 'Ange titel för anteckningen',
            placeHolder: 'Min Anteckning'
        });
        if (title) {
            await notesProvider.createNote(title, false, selectedFolder);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('quickNotes.newTodo', async () => {
        const notesFolder = await notesProvider.getNotesFolder(); // --- FIX --- (await)
        if (!notesFolder) {
            return;
        }
        const allFolders = await notesProvider.getFolders(notesFolder);
        const quickPickItems = [
            { label: "$(file-directory) Spara i roten ( / )", folderName: undefined },
            ...allFolders.map(f => ({ label: `$(folder) ${f}`, folderName: f }))
        ];
        const selection = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: "Välj en mapp att spara todolistan i"
        });
        if (!selection) {
            return;
        }
        const selectedFolder = selection.folderName;
        const title = await vscode.window.showInputBox({
            prompt: 'Ange titel för todolistan',
            placeHolder: 'Min Todolista'
        });
        if (title) {
            await notesProvider.createNote(title, true, selectedFolder);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('quickNotes.newFolder', async () => {
        const folderName = await vscode.window.showInputBox({
            prompt: 'Enter folder name',
            placeHolder: 'My Folder'
        });
        if (folderName) {
            await notesProvider.createFolder(folderName);
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
        // --- FIX --- (Korrekt kommando för att uppdatera när panelen syns)
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
            const notesData = await this.getNotes(await this.getNotesFolder(), await this.getDailyNotesFolder());
            this._view.webview.postMessage({ type: 'notesUpdate', notesData: notesData });
        }
    }
    async sendFoldersToWebview() {
        if (this._view) {
            const folders = await this.getFolders(await this.getNotesFolder());
            this._view.webview.postMessage({ type: 'foldersUpdate', folders });
        }
    }
    async getFolders(notesFolder) {
        if (!notesFolder) {
            return [];
        }
        try {
            // Kontrollera om mappen finns FÖRST
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
        await this.setMetadata(filePath, metadata);
        this.refresh();
    }
    async moveNoteToFolder(filePath, folderName) {
        try {
            const notesFolder = await this.getNotesFolder();
            if (!notesFolder) {
                vscode.window.showErrorMessage('Cannot move note: no notes folder found.');
                return;
            }
            const fileName = path.basename(filePath);
            if (folderName === '') {
                const newPath = path.join(notesFolder, fileName);
                if (filePath !== newPath) {
                    await fsPromises.rename(filePath, newPath);
                    const oldMetadata = this.getMetadata(filePath);
                    await this._context.globalState.update(`note_metadata_${filePath}`, undefined);
                    delete oldMetadata.folder;
                    await this.setMetadata(newPath, oldMetadata);
                }
            }
            else {
                const folderPath = path.join(notesFolder, folderName);
                if (!fs.existsSync(folderPath)) {
                    await fsPromises.mkdir(folderPath, { recursive: true });
                }
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
    async createFolder(folderName) {
        try {
            const notesFolder = await this.getNotesFolder();
            if (!notesFolder) {
                vscode.window.showErrorMessage('Cannot create folder: no notes folder found.');
                return;
            }
            if (!fs.existsSync(notesFolder)) {
                await fsPromises.mkdir(notesFolder, { recursive: true });
            }
            const folderPath = path.join(notesFolder, folderName);
            if (!fs.existsSync(folderPath)) {
                await fsPromises.mkdir(folderPath, { recursive: true });
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
    async getNotes(projectNotesPath, dailyNotesPath) {
        const result = {
            pinned: [],
            folders: {},
            root: []
        };
        const allDeadlines = new Set();
        if (dailyNotesPath && fs.existsSync(dailyNotesPath)) {
            const dailyNotes = await this.readNotesFromFolder(dailyNotesPath, allDeadlines);
            if (dailyNotes.root.length > 0 || Object.keys(dailyNotes.folders).length > 0) {
                let allDailyNotes = [...dailyNotes.root];
                Object.values(dailyNotes.folders).forEach(folderContent => {
                    allDailyNotes.push(...folderContent);
                });
                result.folders[DAILY_NOTES_DISPLAY_NAME] = allDailyNotes;
            }
        }
        if (projectNotesPath && fs.existsSync(projectNotesPath)) {
            if (dailyNotesPath && projectNotesPath === path.dirname(dailyNotesPath)) {
                const projectNotes = await this.readNotesFromFolder(projectNotesPath, allDeadlines, [DAILY_NOTES_FOLDER_NAME]);
                result.pinned.push(...projectNotes.pinned);
                result.root.push(...projectNotes.root);
                for (const folderName in projectNotes.folders) {
                    result.folders[folderName] = (result.folders[folderName] || []).concat(projectNotes.folders[folderName]);
                }
            }
            else {
                const projectNotes = await this.readNotesFromFolder(projectNotesPath, allDeadlines);
                result.pinned.push(...projectNotes.pinned);
                result.root.push(...projectNotes.root);
                for (const folderName in projectNotes.folders) {
                    result.folders[folderName] = (result.folders[folderName] || []).concat(projectNotes.folders[folderName]);
                }
            }
        }
        log('Sending deadlines to WebView:', Array.from(allDeadlines));
        return { ...result, deadlines: Array.from(allDeadlines) };
    }
    async readNotesFromFolder(notesFolder, allDeadlines, excludeFolders = []) {
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
                const noteData = await this.getNoteData(notesFolder, file);
                noteData.deadlines.forEach((d) => allDeadlines.add(d));
                const metadata = this.getMetadata(noteData.filePath);
                if (metadata.pinned) {
                    result.pinned.push({ ...noteData, pinned: true });
                }
                else {
                    result.root.push(noteData);
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
                    const noteData = await this.getNoteData(folderPath, file);
                    noteData.deadlines.forEach((d) => allDeadlines.add(d));
                    const metadata = this.getMetadata(noteData.filePath);
                    folderNotes.push({ ...noteData, folder: folder, pinned: metadata.pinned || false });
                }
                catch (e) {
                    log(`Could not read file data from ${file} in folder ${folder}: ${e}`);
                }
            }
            result.folders[folder] = folderNotes;
        }
        return result;
    }
    async getNoteData(folderPath, file) {
        const filePath = path.join(folderPath, file);
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const isTodoList = content.includes('- [ ]') || content.includes('- [x]');
        const fileName = path.basename(file, '.md');
        const todos = isTodoList ? await this.getTodoItems(filePath) : [];
        const deadlineRegex = /#DEADLINE\s*\(\s*(\d{4}-\d{2}-\d{2})\s*\)/gi;
        const deadlines = [];
        let match;
        while ((match = deadlineRegex.exec(content)) !== null) {
            log(`Found deadline: ${match[1]} in file ${file}`);
            deadlines.push(match[1]);
        }
        return {
            title: fileName,
            filePath: filePath,
            isTodoList: isTodoList,
            todos: todos,
            deadlines: deadlines
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
    async getNotesFolder() {
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
        let notesRoot;
        if (workspaceFolder) {
            notesRoot = path.join(workspaceFolder.uri.fsPath, 'quick-notes');
        }
        else {
            notesRoot = path.join(os.homedir(), 'Notes');
        }
        try {
            await fsPromises.mkdir(notesRoot, { recursive: true });
        }
        catch (error) {
            log(`Could not create default notes folder: ${error}`);
        }
        return notesRoot;
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
    async createNote(title, isTodoList, folderName) {
        try {
            const notesFolder = await this.getNotesFolder();
            if (!notesFolder) {
                vscode.window.showErrorMessage('Cannot create note: no notes folder is configured.');
                return;
            }
            // Måste inte 'awaita' denna, men det skadar inte
            await fsPromises.mkdir(notesFolder, { recursive: true });
            const targetFolder = folderName ? path.join(notesFolder, folderName) : notesFolder;
            if (folderName) {
                await fsPromises.mkdir(targetFolder, { recursive: true });
            }
            const fileName = `${title}.md`;
            const filePath = path.join(targetFolder, fileName);
            // Använd 'access' för att kolla om filen finns (async)
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
            await vscode.window.showTextDocument(doc);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to create note: ${error instanceof Error ? error.message : 'Unknown error'}`);
            log('Create note error:', error);
        }
    }
    async createNoteFromDate(dateString) {
        try {
            const date = new Date(dateString);
            const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
            const title = `Note ${localDate.toISOString().split('T')[0]}`;
            const dailyNotesFolder = this.getDailyNotesFolder(); // Denna är sync
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
            await vscode.window.showTextDocument(doc);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to create daily note: ${error instanceof Error ? error.message : 'Unknown error'}`);
            log('Create daily note error:', error);
        }
    }
    openNote(filePath) {
        vscode.window.showTextDocument(vscode.Uri.file(filePath));
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
        // --- NY/ÄNDRAD --- (Lade till 'collapseState' och bytte engelska i JS)
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
                
                .folder-contents {
                    margin-left: 20px;
                    margin-top: 4px;
                }
                
                .folder-contents.collapsed {
                    display: none;
                }
                
                .note-item {
                    margin-bottom: 8px;
                    padding: 8px;
                    background-color: var(--vscode-list-inactiveSelectionBackground);
                    border-radius: 4px;
                    cursor: pointer;
                    position: relative;
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
                }
                
                .note-title {
                    font-weight: bold;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex: 1;
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
                }
                
                .todo-list {
                    margin-top: 8px;
                    padding-left: 20px;
                }
                
                .todo-list.collapsed {
                    display: none;
                }
                
                .todo-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 0;
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
                    
                    // --- NY/ÄNDRAD --- (Minnet för att spara mapp-lägen)
                    let collapseState = {};

                    // Request initial notes
                    vscode.postMessage({ type: 'requestNotes' });
                    vscode.postMessage({ type: 'getFolders' });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'notesUpdate') {
                            const notesData = message.notesData; 
                            currentNotes = notesData; 
                            deadlineDates = notesData.deadlines || []; 
                            
                            renderNotes();
                            renderCalendar();
                        } else if (message.type === 'foldersUpdate') {
                            availableFolders = message.folders;
                        }
                    });

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

                        if (currentNotes.pinned.length > 0) {
                            const pinnedHeader = document.createElement('div');
                            pinnedHeader.className = 'section-header';
                            pinnedHeader.textContent = 'Pinned';
                            container.appendChild(pinnedHeader);

                            currentNotes.pinned.forEach(note => {
                                container.appendChild(createNoteElement(note, true));
                            });
                        }

                        if (Object.keys(currentNotes.folders).length > 0) {
                            const foldersHeader = document.createElement('div');
                            foldersHeader.className = 'section-header';
                            foldersHeader.textContent = 'Folders';
                            container.appendChild(foldersHeader);

                            Object.keys(currentNotes.folders).sort().forEach(folderName => {
                                const folderDiv = document.createElement('div');
                                folderDiv.className = 'folder-item';

                                const folderHeaderDiv = document.createElement('div');
                                folderHeaderDiv.className = 'folder-header';

                                const arrow = document.createElement('span');
                                arrow.className = 'folder-arrow';
                                arrow.textContent = '▼';

                                const icon = document.createElement('span');
                                icon.className = 'folder-icon';
                                if (folderName === 'Daily Notes (Global)') {
                                    icon.textContent = '📅'; 
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
                                
                                // --- NY/ÄNDRAD --- (Läser från minnet)
                                if (collapseState[folderName] === 'collapsed') {
                                    arrow.classList.add('collapsed');
                                    folderContents.classList.add('collapsed');
                                }

                                currentNotes.folders[folderName].forEach(note => {
                                    folderContents.appendChild(createNoteElement(note, note.pinned));
                                });

                                folderHeaderDiv.onclick = () => {
                                    // --- NY/ÄNDRAD --- (Spara till minnet)
                                    const isCollapsed = arrow.classList.toggle('collapsed');
                                    folderContents.classList.toggle('collapsed');
                                    collapseState[folderName] = isCollapsed ? 'collapsed' : 'expanded';
                                };

                                folderDiv.appendChild(folderHeaderDiv);
                                folderDiv.appendChild(folderContents);
                                container.appendChild(folderDiv);
                            });
                        }

                        if (currentNotes.root.length > 0) {
                            const notesHeader = document.createElement('div');
                            notesHeader.className = 'section-header';
                            notesHeader.textContent = 'Notes';
                            container.appendChild(notesHeader);

                            currentNotes.root.forEach(note => {
                                container.appendChild(createNoteElement(note, false));
                            });
                        }
                    }

                    function createNoteElement(note, isPinned) {
                        const noteDiv = document.createElement('div');
                        noteDiv.className = 'note-item';
                        
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
                        
                        const iconSpan = document.createElement('span');
                        iconSpan.className = 'note-icon';
                        iconSpan.textContent = note.isTodoList ? '☑' : '📝';
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
                        deleteBtn.onclick = (e) => {
                            e.stopPropagation();
                            vscode.postMessage({
                                type: 'deleteNote',
                                filePath: note.filePath,
                                title: note.title
                            });
                        };
                        
                        actionsDiv.appendChild(pinBtn);
                        actionsDiv.appendChild(deleteBtn);
                        
                        headerDiv.appendChild(titleDiv);
                        headerDiv.appendChild(actionsDiv);
                        noteDiv.appendChild(headerDiv);
                        
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
                        
                        const moveToRootItem = document.createElement('div');
                        moveToRootItem.className = 'context-menu-item';
                        moveToRootItem.textContent = '📂 Move to Root';
                        moveToRootItem.onclick = () => {
                            vscode.postMessage({
                                type: 'moveToFolder',
                                filePath: note.filePath,
                                folderName: ''
                            });
                            hideContextMenu();
                        };
                        menu.appendChild(moveToRootItem);
                        
                        if (availableFolders.length > 0) {
                            availableFolders.forEach(folder => {
                                const folderItem = document.createElement('div');
                                folderItem.className = 'context-menu-item';
                                folderItem.textContent = '📁 Move to ' + folder;
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
                        }
                        
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

                    function renderCalendar() {
                        const calendar = document.getElementById('calendar');
                        const monthLabel = document.getElementById('current-month');
                        
                        const year = currentDate.getFullYear();
                        const month = currentDate.getMonth();
                        
                        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                                          'July', 'August', 'September', 'October', 'November', 'December'];
                        monthLabel.textContent = \`\${monthNames[month]} \${year}\`;
                        
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
                            const dateString = \`\${year}-\${monthString}-\${dayString}\`;

                            if (deadlineDates.includes(dateString)) {
                                dayDiv.classList.add('deadline');
                            }
                            
                            const dayDate = new Date(year, month, day);
                            
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
                                    date: dayDate.toISOString()
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
                }()); // --- NY/ÄNDRAD --- (Avslutar IIFE)
            </script>
        </body>
        </html>`;
    }
}
function deactivate() {
    log('Quick Notes extension deactivated');
}
//# sourceMappingURL=extension.js.map