# QuickFix Tunisia

## E-mails de réinitialisation de mot de passe

Pour la démo, les liens de réinitialisation sont envoyés gratuitement depuis une boîte Gmail dédiée. Ajoutez ces valeurs à `.env.local` (ne les commitez jamais) :

```env
APP_URL=http://localhost:3000
SMTP_USER=quickfix.demo@gmail.com
SMTP_APP_PASSWORD=mot-de-passe-d-application-google
```

Activez d’abord la validation en deux étapes du compte Google, puis créez un mot de passe d’application et utilisez-le pour `SMTP_APP_PASSWORD` ; ne renseignez jamais le mot de passe Gmail habituel. En production, `APP_URL` doit être l’URL HTTPS publique de l’application. Gmail SMTP utilise `smtp.gmail.com` avec une connexion chiffrée et une authentification.

Application web progressive Next.js, pensée d'abord pour mobile, qui met en relation clients et artisans de proximité.

## Démarrage

1. Installer Node.js 20.9 ou supérieur.
2. Copier `.env.example` vers `.env.local` et y renseigner l'URI MongoDB. Pour activer l'assistant IA, renseigner `MODAL_AI_URL` et `MODAL_AI_TOKEN` (voir « Lecture automatique » plus bas) ou, à défaut, `OPENAI_API_KEY`.
3. Installer les dépendances avec `npm install`.
4. Lancer l'application avec `npm run dev`, puis ouvrir [http://localhost:3000](http://localhost:3000).

La connexion à MongoDB est centralisée dans `src/lib/mongodb.ts`. Les modèles Mongoose du domaine QuickFix se trouvent dans `src/models/`. La route `GET /api/health/db` vérifie la connexion sans exposer l'URI. La route `GET /api/artisans` renvoie les profils vérifiés sans leurs coordonnées privées.

Ne partagez pas votre URI MongoDB dans le chat et ne la commitez jamais. Gardez-la dans `.env.local`, un fichier ignoré par Git.

QuickFix peut être installé comme application web progressive (PWA) depuis un navigateur compatible. Le déploiement doit utiliser HTTPS. Sur Android, utilisez le menu du navigateur ou le bouton « Installer l’app » ; sur iPhone/iPad, ouvrez le site dans Safari, appuyez sur « Partager », puis « Sur l’écran d’accueil ».

L’assistant IA, disponible depuis l’accueil, est un chatbot qui oriente le client vers une filière artisanale, lui propose jusqu’à trois artisans vérifiés et disponibles de cette filière dans sa ville (ou, s’il n’y en a aucun, le signale et propose ceux d’autres villes) et répond aux questions sur le fonctionnement de QuickFix. Il utilise le modèle hébergé sur le GPU Modal (le même service que la lecture des pièces d’identité, route `/chat`) quand `MODAL_AI_URL` et `MODAL_AI_TOKEN` sont renseignés, sinon l’API OpenAI avec `OPENAI_API_KEY`. Ces valeurs ne doivent jamais être exposées dans le navigateur ou partagées. Après une pause, la première réponse attend le démarrage du GPU (environ 30 secondes). Les artisans proposés viennent de l’annuaire, jamais du modèle. Les conversations ne sont pas enregistrées dans la base QuickFix ni par le service Modal. Évitez de saisir des informations personnelles. Sans configuration, l’interface affiche une erreur de configuration.

## Créer un compte artisan

Les clients et les artisans peuvent créer un compte depuis le site en choisissant leur rôle. Le parcours de création artisan demande le téléphone, la filière et la ville. La ville se choisit dans une liste fixe, les chefs-lieux des 24 gouvernorats (`src/lib/cities.ts`) ; l’assistant IA utilise la même liste. La commande `npm run create:artisan` reste disponible pour ajouter manuellement un compte de test ou un compte préparé depuis le terminal ; elle masque le mot de passe et crée le compte ainsi que son profil dans une transaction. Utilisez uniquement les informations de personnes ayant donné leur accord. Seuls les profils vérifiés avec une pièce d’identité et les comptes actifs apparaissent sur le site. Les comptes connectés peuvent changer leur mot de passe dans l’onglet Profil ; les autres sessions sont alors révoquées.

L’inscription publique propose deux rôles, Client et Artisan, sans confirmation par e-mail. Les deux comptes peuvent se connecter immédiatement. Pour apparaître dans l’annuaire et recevoir de nouvelles demandes, l’artisan doit ouvrir la vérification d’identité depuis « Profil », envoyer une pièce d’identité (JPG, PNG, WebP ou PDF, 5 Mo maximum), puis attendre son approbation dans « Vérification artisan ». Le profil affiche l’état du dossier sans permettre un nouvel envoi pendant la vérification. Si son dossier est refusé, le motif apparaît dans son profil et il peut envoyer une nouvelle pièce. Les documents sont conservés dans un compartiment GridFS distinct et ne peuvent être téléchargés que par un administrateur connecté. Les profils déjà approuvés sans pièce doivent également en envoyer une et être approuvés à nouveau. Avant toute mise en production, définir une durée de conservation, une procédure de suppression, une politique d’accès et les mesures légales et de sécurité adaptées aux pièces d’identité.

### Lecture automatique (OCR) des pièces d’identité

Optionnelle. Quand `MODAL_AI_URL` et `MODAL_AI_TOKEN` sont renseignés, chaque pièce envoyée est lue par un modèle de vision (Qwen2.5-VL) hébergé sur un GPU [Modal](https://modal.com) : type de document, nom (en écriture d’origine et en lettres latines), numéro, dates de naissance et d’expiration. La lecture démarre après la réponse à l’envoi ; l’artisan n’attend pas. L’administrateur voit le résultat dans « Vérification artisan », avec une alerte si le nom lu ne correspond pas au nom du compte, si la pièce semble expirée ou si le fichier n’est pas une pièce d’identité, et peut relancer la lecture. **La lecture n’approuve et ne refuse jamais un dossier** : elle peut se tromper, la décision reste humaine. L’artisan ne voit pas ces informations.

Déploiement du service (dossier `ocr-service/`) :

1. `pip install modal` puis `python -m modal setup`.
2. Créer le secret : `python -m modal secret create quickfix-identity-ocr OCR_API_TOKEN=<jeton aléatoire>`.
3. `python -m modal deploy ocr-service/identity_ocr.py`, puis copier l’URL affichée dans `MODAL_AI_URL` et le jeton dans `MODAL_AI_TOKEN`.

Le GPU s’éteint après deux minutes sans demande ; la première lecture après une pause prend une à deux minutes. Le service ne conserve ni les documents ni le texte lu, mais les pièces transitent par Modal : à mentionner dans la politique de confidentialité avant une mise en production.

Créez un compte administrateur depuis le terminal avec `npm run create:admin`. Le mot de passe est masqué et n'est jamais demandé par une route publique. Après connexion, l'administrateur arrive directement dans son espace sécurisé, avec les onglets « Vérification artisan », « Artisans », « Avis clients » et « Réclamations » ; les onglets client « Explorer » et « Mes demandes » ne sont pas affichés. La vérification permet d'approuver les profils en attente ou de les refuser avec un motif. La gestion des artisans permet de créer, modifier, désactiver et réactiver leurs comptes. Un compte créé par l'administration reçoit un mot de passe temporaire, affiché une seule fois ; l'artisan doit le changer dans son profil avant d'utiliser les fonctions de l'application. La désactivation conserve les demandes et l'historique, mais masque le profil.

Les clients connectés peuvent envoyer une demande à un artisan disponible avec une adresse, une date souhaitée, une position GPS facultative consultable sur une carte OpenStreetMap, un budget indicatif, le type de lieu, le niveau d'urgence, des détails d'accès et jusqu'à quatre photos (15 Mo au total). Les artisans connectés peuvent consulter ces informations et voient un indicateur sur l'onglet Demandes lorsqu'une demande attend leur réponse. En acceptant une demande, ils préparent un devis détaillé par postes, avec une date de validité ; le devis est consultable par le client dans « Mes demandes » et un message l'en informe dans leur conversation. Le client et l'artisan peuvent télécharger le devis en PDF depuis la demande, y compris les demandes historiques ne contenant qu'un montant global. Lorsque le client valide le devis, QuickFix génère un PDF reprenant les coordonnées des deux participants, les détails de l'intervention et les postes du devis, puis le partage automatiquement dans leur conversation. Le PDF peut être ouvert ou téléchargé depuis la discussion. Les artisans retrouvent aussi leurs coordonnées et informations professionnelles dans leur compte. Un client peut annuler une demande en attente ou acceptée. Les adresses, positions et photos d'intervention ne sont accessibles qu'aux deux participants.

Après une demande terminée, le client peut noter l’artisan de 1 à 5 étoiles et ajouter un commentaire ; les avis apparaissent dans l’administration et la note publique de l’artisan est calculée à partir des avis publiés. Le client peut aussi envoyer une réclamation liée à une demande, que l’administration peut consulter et marquer comme résolue.

Les clients peuvent démarrer une conversation depuis le profil public d’un artisan vérifié ; les artisans répondent depuis « Messages ». L’administration peut sélectionner un artisan dans sa fiche, consulter son e-mail et son téléphone, puis lui écrire depuis la messagerie. Les conversations sont privées aux participants et actualisées automatiquement. Les messages acceptent du texte et une image ou un PDF (5 Mo maximum), stockés dans MongoDB GridFS.

## Missions et propositions

Dans « Missions », un client peut publier une mission par catégorie avec une ville, une date et un budget indicatif. La description est visible par les artisans correspondants ; l’adresse exacte reste privée jusqu’au choix d’une proposition. Les artisans vérifiés et disponibles peuvent envoyer un devis détaillé et un message. Le client compare les propositions et confirme son choix, ce qui crée une demande acceptée dans « Mes demandes ». Les missions ouvertes peuvent être annulées par leur client. Les autres propositions sont automatiquement closes lorsqu’une mission est attribuée ou annulée.

Une commission artisan indicative de 5 % et le net estimé sont affichés sur les propositions. L’application ne collecte ni paiement ni commission. L’attribution et la soumission utilisent des transactions MongoDB ; la base doit donc prendre en charge les transactions.

## Périmètre initial

- Interface client responsive avec recherche et catégories de services.
- Comptes clients et artisans avec sessions HTTPOnly, inscription/connexion/déconnexion et validation administrative des profils artisans.
- Tableau d'administration protégé par rôle pour vérifier et gérer les profils artisans.
- Assistant IA optionnel pour orienter un client vers une catégorie d’artisan.
- Demandes de service persistantes avec contrôle des rôles et transitions de statut.
- Consultation des profils d'artisans vérifiés depuis MongoDB et filtres de disponibilité/note.
- Manifest, icône et service worker avec cache hors ligne de la page d'accueil.
- Installation PWA avec guide adapté à iOS et aux autres navigateurs mobiles.
- Modèles MongoDB pour les comptes, profils artisans, demandes, devis, avis, réclamations et conversations.

Les paiements, les notifications et les procédures de récupération de compte restent à développer. Avant une mise en production publique, ajouter notamment la récupération de mot de passe, une politique anti-abus, et les vérifications légales et opérationnelles nécessaires.
