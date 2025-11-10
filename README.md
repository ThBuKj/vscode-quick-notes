# Quick Notes & Todos

Ett enkelt och snabbt anteckningstillägg för VS Code, direkt i ditt sidofält. Detta tillägg är perfekt för att snabbt skriva ner anteckningar, hantera TODO-listor och hålla koll på deadlines med en inbyggd kalender.

Detta projekt är byggt för att separera dina globala anteckningar (som alltid är tillgängliga) från projektspecifika anteckningar (som bara visas när du arbetar i det projektet).


![Screenshot](https://i.imgur.com/P1umgSD.jpeg)

(Har fäst den på höger sida i VS Code, istället för chatten)


## Funktioner

- **Globala Mappar**: "Daily Notes" och "Global Notes" finns alltid i ditt sidofält, oavsett vilket projekt du har öppet.
- **Projektspecifika Anteckningar**: Mappar och anteckningar som skapas i ett projekt stannar i det projektet.
- **Kalendervy**: En enkel kalender som visar dina deadlines. Klicka på ett datum för att skapa en ny "Daily note" för den dagen.
- **TODO-Listor**: Skapa markdown-baserade TODO-listor (`- [ ]`) och bocka av uppgifter direkt från sidofältet.
- **Global Pinfunktion**: Fäst (pin) dina viktigaste anteckningar (från både globala och projektmappar) högst upp. Din Pinned-lista är global och följer med dig överallt.
- **Anpassade Taggar**: Använd taggar som `#TODO` eller `#BUG` för att kategorisera. Skapa datum-taggar som `#DEADLINE(ÅÅÅÅ-MM-DD)` för att automatiskt markera dem i kalendern.

## Installation (För Användare)

Detta är det enklaste sättet att installera tillägget och bara använda det.

1. Gå till [Releases-sidan](https://github.com/ThBuKj/vscode-quick-notes/releases) här på GitHub.
2. Ladda ner den senaste `.vsix`-filen (t.ex. `quick-notes-extension-1.1.0.vsix`).
3. Öppna VS Code och gå till Extensions-vyn (`Ctrl+Shift+X`).
4. Klicka på de tre prickarna (`...`) högst upp i Extensions-vyn.
5. Välj "Install from VSIX..." och välj filen du precis laddade ner.
6. Starta om VS Code om det behövs. Klart!

## Installation (För Utvecklare)

Om du vill hjälpa till att utveckla, köra från källkod eller bara se hur det fungerar.

1. **Klona repot**:
   ```bash
   git clone https://github.com/ThBuKj/vscode-quick-notes.git
   ```

2. **Installera beroenden**:
   ```bash
   cd vscode-quick-notes
   npm install
   ```

3. **Kompilera koden**:
   ```bash
   npm run compile
   ```

4. **Kör i VS Code**:
   - Öppna mappen i VS Code.
   - Tryck på `F5` för att starta "Extension Development Host" (ett nytt VS Code-fönster).
   - Tillägget kommer nu att vara aktivt i det nya fönstret.

---

**Lycka till med ditt projekt!** 🚀
