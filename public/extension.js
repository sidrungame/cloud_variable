// Sidrungame Cloud Variables — extension TurboWarp
// Se connecte au serveur cloud perso : https://github.com/sidrungame/cloud_variable
// Doit être chargée en "unsandboxed" (TurboWarp demandera confirmation).

(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error('Cette extension doit tourner en mode non sandboxé.');
  }

  const SERVER_URL = 'wss://cloud-server-sidrungame.onrender.com/';
  const HTTP_URL = SERVER_URL.replace(/^ws/, 'http');
  const REPO_URL = 'https://github.com/sidrungame/cloud_variable';

  const CHANGELOG = [
    {
      date: '2026-08-18b',
      title: '10 nouveaux blocs',
      points: [
        'Ajout de blocs pour vérifier si une room est prise, si une variable existe, compter les joueurs connectés, augmenter une variable, la supprimer/renommer, et deux nouveaux événements de connexion/déconnexion.',
        'Les blocs "room prise ?" et "nombre de joueurs" interrogent le serveur en direct (petit délai réseau, normal).',
        'Supprimer/renommer une variable ne fonctionne que si ces options sont activées côté serveur (désactivées par défaut).',
      ],
    },
    {
      date: '2026-08-18',
      title: 'Lancement du serveur',
      points: [
        'Serveur cloud perso, hébergé gratuitement sur Render.',
        'Persistance activée : les variables sont sauvegardées dans une base Redis (Upstash) et survivent aux redémarrages du serveur.',
        "Une variable est effacée si sa room reste inactive (personne connecté) pendant 30 jours.",
        'Attention : sur le plan gratuit Render, le serveur se met en veille après ~15 min sans connexion. La première reconnexion après une veille peut prendre 30 à 60 secondes.',
        'Maximum 128 variables et 128 clients par room.',
        'Le renommage et la suppression de variables sont désactivés côté serveur par défaut.',
      ],
    },
  ];

  class CloudVariableClient {
    constructor() {
      /** @type {?WebSocket} */
      this.ws = null;
      this.connected = false;
      this.room = null;
      this.username = '';
      /** @type {Map<string, string>} Dernière valeur connue par variable. */
      this.values = new Map();
      /** @type {Map<string, string>} Dernière valeur vue par les hats "when changes". */
      this.seenByHat = new Map();
      this.reconnectDelay = 1000;
      this.shouldReconnect = false;
      this._lastForConnectedHat = false;
      this._lastForDisconnectedHat = false;
    }

    connect(room, username) {
      this.disconnect();
      this.room = room;
      this.username = username;
      this.shouldReconnect = true;
      this._open();
    }

    _open() {
      let ws;
      try {
        ws = new WebSocket(SERVER_URL);
      } catch (e) {
        console.error('[Sidrungame Cloud] Impossible de se connecter :', e);
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        this.reconnectDelay = 1000;
        ws.send(JSON.stringify({
          method: 'handshake',
          project_id: this.room,
          user: this.username,
        }));
      };

      ws.onmessage = (event) => {
        const lines = String(event.data).split('\n');
        for (const line of lines) {
          if (!line) continue;
          let message;
          try {
            message = JSON.parse(line);
          } catch (e) {
            continue;
          }
          if (message.method === 'set') {
            this.values.set(message.name, String(message.value));
          }
        }
      };

      ws.onclose = () => {
        this.connected = false;
        this.ws = null;
        if (this.shouldReconnect) {
          setTimeout(() => {
            if (this.shouldReconnect) this._open();
          }, this.reconnectDelay);
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        }
      };

      ws.onerror = () => {
        // onclose will fire right after; reconnection is handled there.
      };
    }

    disconnect() {
      this.shouldReconnect = false;
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.connected = false;
      this.values.clear();
    }

    _send(payload) {
      if (this.ws && this.connected) {
        this.ws.send(JSON.stringify(payload));
      }
    }

    createVar(name, value) {
      this.values.set(name, String(value));
      this._send({ method: 'create', name, value: String(value) });
    }

    setVar(name, value) {
      this.values.set(name, String(value));
      this._send({ method: 'set', name, value: String(value) });
    }

    getVar(name) {
      return this.values.has(name) ? this.values.get(name) : '';
    }

    hasChanged(name) {
      const current = this.values.has(name) ? this.values.get(name) : '';
      const last = this.seenByHat.has(name) ? this.seenByHat.get(name) : '';
      this.seenByHat.set(name, current);
      return current !== last;
    }

    hasVar(name) {
      return this.values.has(name);
    }

    deleteVar(name) {
      this.values.delete(name);
      this._send({ method: 'delete', name });
    }

    renameVar(oldName, newName) {
      if (this.values.has(oldName)) {
        this.values.set(newName, this.values.get(oldName));
        this.values.delete(oldName);
      }
      this._send({ method: 'rename', name: oldName, new_name: newName });
    }

    listVarNames() {
      return Array.from(this.values.keys()).join(', ');
    }

    justConnected() {
      const now = this.connected;
      const fired = now && !this._lastForConnectedHat;
      this._lastForConnectedHat = now;
      return fired;
    }

    justDisconnected() {
      const now = this.connected;
      const fired = !now && this._lastForDisconnectedHat;
      this._lastForDisconnectedHat = now;
      return fired;
    }

    async fetchRoomInfo(room) {
      try {
        const response = await fetch(`${HTTP_URL}api/room-info?room=${encodeURIComponent(room)}`);
        if (!response.ok) return null;
        return await response.json();
      } catch (e) {
        console.error('[Sidrungame Cloud] Impossible de vérifier la room :', e);
        return null;
      }
    }
  }

  function showWhatsNewPopup() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background: white; color: #222; border-radius: 12px;
      max-width: 480px; width: 90%; max-height: 80vh; overflow-y: auto;
      padding: 20px 24px; box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    `;

    let html = `
      <h2 style="margin-top:0;color:#FF8C1A;">☁️ Sidrungame Cloud — Quoi de neuf ?</h2>
      <p style="font-size:13px;color:#575E75;">
        Infos pour les développeurs qui utilisent mon serveur de variables cloud perso.
      </p>
    `;
    for (const entry of CHANGELOG) {
      html += `<h3 style="margin-bottom:4px;">${entry.date} — ${entry.title}</h3><ul style="margin-top:4px;">`;
      for (const point of entry.points) {
        html += `<li style="margin-bottom:6px;font-size:14px;">${point}</li>`;
      }
      html += '</ul>';
    }
    html += `
      <p style="font-size:13px;">
        Code source du serveur : <a href="${REPO_URL}" target="_blank" rel="noopener">${REPO_URL}</a>
      </p>
    `;

    box.innerHTML = html;

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Fermer';
    closeButton.style.cssText = `
      margin-top: 12px; padding: 8px 16px; border: none; border-radius: 8px;
      background: #FF8C1A; color: white; font-weight: bold; cursor: pointer;
    `;
    closeButton.onclick = () => overlay.remove();
    box.appendChild(closeButton);

    overlay.appendChild(box);
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    document.body.appendChild(overlay);
  }

  const client = new CloudVariableClient();

  class SidrungameCloudExtension {
    getInfo() {
      return {
        id: 'sidrungameCloud',
        name: 'Sidrungame Cloud',
        color1: '#FF8C1A',
        color2: '#E67E00',
        blocks: [
          {
            opcode: 'whatsNew',
            func: 'whatsNew',
            blockType: Scratch.BlockType.BUTTON,
            text: "ℹ️ What's new?",
          },
          '---',
          {
            opcode: 'connect',
            blockType: Scratch.BlockType.COMMAND,
            text: 'connect to my cloud server, room [ROOM] as [USERNAME]',
            arguments: {
              ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'my-project' },
              USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'player' },
            },
          },
          {
            opcode: 'disconnect',
            blockType: Scratch.BlockType.COMMAND,
            text: 'disconnect from cloud server',
          },
          {
            opcode: 'isConnected',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'connected to cloud server?',
          },
          '---',
          {
            opcode: 'createVar',
            blockType: Scratch.BlockType.COMMAND,
            text: 'create cloud variable [NAME] = [VALUE]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' },
              VALUE: { type: Scratch.ArgumentType.STRING, defaultValue: '0' },
            },
          },
          {
            opcode: 'setVar',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set cloud variable [NAME] to [VALUE]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' },
              VALUE: { type: Scratch.ArgumentType.STRING, defaultValue: '0' },
            },
          },
          {
            opcode: 'getVar',
            blockType: Scratch.BlockType.REPORTER,
            text: 'cloud variable [NAME]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' },
            },
          },
          {
            opcode: 'whenChanged',
            blockType: Scratch.BlockType.HAT,
            text: 'when cloud variable [NAME] changes',
            isEdgeActivated: true,
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' },
            },
          },
          {
            opcode: 'variableExists',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'variable [NAME] existe?',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' },
            },
          },
          {
            opcode: 'increaseVar',
            blockType: Scratch.BlockType.COMMAND,
            text: 'increase cloud variable [NAME] by [DELTA]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' },
              DELTA: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 },
            },
          },
          {
            opcode: 'deleteVar',
            blockType: Scratch.BlockType.COMMAND,
            text: 'delete cloud variable [NAME]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' },
            },
          },
          {
            opcode: 'renameVar',
            blockType: Scratch.BlockType.COMMAND,
            text: 'rename cloud variable [OLD_NAME] to [NEW_NAME]',
            arguments: {
              OLD_NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' },
              NEW_NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'score2' },
            },
          },
          {
            opcode: 'listVarNames',
            blockType: Scratch.BlockType.REPORTER,
            text: 'list of known cloud variables',
          },
          '---',
          {
            opcode: 'roomTaken',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'room name [ROOM] pris?',
            arguments: {
              ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'my-project' },
            },
          },
          {
            opcode: 'playersInRoom',
            blockType: Scratch.BlockType.REPORTER,
            text: 'number of players in room [ROOM]',
            arguments: {
              ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'my-project' },
            },
          },
          {
            opcode: 'currentRoom',
            blockType: Scratch.BlockType.REPORTER,
            text: 'current room name',
          },
          '---',
          {
            opcode: 'whenConnected',
            blockType: Scratch.BlockType.HAT,
            text: 'when connected to cloud server',
            isEdgeActivated: true,
          },
          {
            opcode: 'whenDisconnected',
            blockType: Scratch.BlockType.HAT,
            text: 'when disconnected from cloud server',
            isEdgeActivated: true,
          },
        ],
      };
    }

    whatsNew() {
      showWhatsNewPopup();
    }

    connect(args) {
      client.connect(String(args.ROOM), String(args.USERNAME));
    }

    disconnect() {
      client.disconnect();
    }

    isConnected() {
      return client.connected;
    }

    createVar(args) {
      client.createVar(String(args.NAME), String(args.VALUE));
    }

    setVar(args) {
      client.setVar(String(args.NAME), String(args.VALUE));
    }

    getVar(args) {
      return client.getVar(String(args.NAME));
    }

    whenChanged(args) {
      return client.hasChanged(String(args.NAME));
    }

    variableExists(args) {
      return client.hasVar(String(args.NAME));
    }

    increaseVar(args) {
      const name = String(args.NAME);
      const current = Number(client.getVar(name)) || 0;
      const delta = Number(args.DELTA) || 0;
      client.setVar(name, current + delta);
    }

    deleteVar(args) {
      client.deleteVar(String(args.NAME));
    }

    renameVar(args) {
      client.renameVar(String(args.OLD_NAME), String(args.NEW_NAME));
    }

    listVarNames() {
      return client.listVarNames();
    }

    async roomTaken(args) {
      const info = await client.fetchRoomInfo(String(args.ROOM));
      return !!(info && info.taken);
    }

    async playersInRoom(args) {
      const info = await client.fetchRoomInfo(String(args.ROOM));
      return info ? info.peers : 0;
    }

    currentRoom() {
      return client.room || '';
    }

    whenConnected() {
      return client.justConnected();
    }

    whenDisconnected() {
      return client.justDisconnected();
    }
  }

  Scratch.extensions.register(new SidrungameCloudExtension());
})(Scratch);
