# SLAM — Le jeu en ligne 🎮

Reproduction du jeu télévisé SLAM (France 3) pour jouer en ligne entre amis.
Parties privées via code, 3 modes (Solo / Duo / Trio), 100% gratuit.

## Stack

- **Serveur** : Node.js + Express + Socket.IO
- **Client** : HTML/CSS/JS vanilla (aucun build)
- **Données** : fichiers JSON (100 questions + 15 grilles manches + 10 grilles finales)
- **Stockage** : en mémoire (pas de BDD)
- **Hébergement** : Render.com (tier gratuit)

---

## 🚀 Démarrage local

```bash
npm install
npm start
```

Puis ouvrir **http://localhost:3000** dans 2 ou 3 onglets / appareils différents.

---

## ☁️ Déploiement gratuit sur Render

### 1. Créer un compte GitHub (gratuit, 2 min)

- https://github.com/signup
- Pas de carte bancaire nécessaire.

### 2. Pousser le code sur GitHub

Depuis ce dossier (`slam/`) :

```bash
git init
git add .
git commit -m "Initial commit SLAM"
git branch -M main
git remote add origin https://github.com/TON_PSEUDO/slam.git
git push -u origin main
```

(Remplace `TON_PSEUDO` par ton pseudo GitHub, crée d'abord un dépôt vide sur github.com appelé `slam`.)

### 3. Créer un compte Render (gratuit)

- https://render.com/ → **Get Started for Free**
- Bouton **Login with GitHub** → autorise Render à lire tes dépôts.
- **Pas de carte bancaire demandée** sur le plan Free.

### 4. Déployer en 1 clic

1. Dans Render : **New +** → **Web Service**
2. Choisis ton dépôt `slam`
3. Render détecte automatiquement `render.yaml` (build = `npm install`, start = `node server/index.js`, plan = Free)
4. Clique **Create Web Service** → déploiement en ~2 min
5. Tu obtiens une URL du type `https://slam-xxxx.onrender.com` → partage-la à tes amis !

### 5. (Optionnel) Éviter la mise en veille

Le plan Free de Render endort le serveur après 15 min d'inactivité → 30 s de latence au réveil.

**Solution gratuite** : créer un monitor UptimeRobot qui ping l'URL toutes les 14 min.
- https://uptimerobot.com/ (gratuit)
- Nouveau monitor **HTTP(s)** → URL = `https://slam-xxxx.onrender.com/ping`
- Intervalle : 5 ou 14 min

---

## 🔑 Quelles clés / credentials as-tu besoin ?

**Aucune clé API.** Zéro. Le jeu n'utilise aucun service externe.

Les seuls comptes à créer (tous **gratuits, sans CB**) :

| Compte | Usage | Obligatoire ? |
|---|---|---|
| GitHub | héberger le code | ✅ oui (Render en a besoin) |
| Render | héberger le serveur | ✅ oui |
| UptimeRobot | éviter la mise en veille | 🔹 optionnel |

---

## 🎮 Règles rapides

### Manche 1 & 2
- Le jeu pose une question, réponse = **UNE lettre**
- Les joueurs buzzent, le plus rapide répond
- Bonne lettre → choisis un mot de la grille contenant cette lettre → 10 s pour le deviner à partir de la définition
- 1 point par lettre du mot trouvé

### SLAM ⚡
- À tout moment, un joueur peut tenter de remplir **toute** la grille d'un coup, **sans définition**
- Réussi → il gagne tous les points restants
- Raté → selon le mode : les points vont à l'adversaire (Duo) ou sont répartis (Trio)

### Finale
- 8 chiffres (1-8) cachent chacun une lettre
- Le finaliste en choisit 5 → ces lettres se révèlent dans une grille de 7 mots thématiques
- 60 s pour compléter un maximum
- 100 pts par mot trouvé • 2 000 pts pour la grille complète

### Tailles de grilles

| | Solo | Duo | Trio |
|---|---|---|---|
| Manche 1 | 8 mots | 8 mots | 10 mots |
| Manche 2 | 10 mots | 10 mots | 12 mots |
| Finale | 7 mots | 7 mots | 7 mots |

---

## 📂 Structure

```
slam/
├── server/              # Backend Node.js
│   ├── index.js         # Express + Socket.IO
│   ├── rooms.js         # Gestion rooms (Map en mémoire)
│   ├── game.js          # Moteur de jeu (manches, SLAM, finale)
│   ├── events.js        # Handlers Socket.IO
│   └── data/            # Questions et grilles (JSON)
├── public/              # Frontend statique
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── package.json
├── render.yaml          # Config déploiement Render
└── README.md
```

---

## 🛠️ Ajouter / modifier des questions et grilles

Tout est dans `server/data/` :

- **`questions.json`** : 100 questions dont la réponse est UNE lettre
- **`manches.json`** : grilles de mots pour les manches 1/2 (clés `"8"`, `"10"`, `"12"` = taille)
- **`finales.json`** : grilles de 7 mots thématiques pour la finale

Il suffit de redémarrer le serveur (ou redéployer sur Render) pour prendre en compte les changements.

---

## 📝 Licence

Fait avec ❤️ pour jouer entre amis. Pas affilié à France Télévisions.
