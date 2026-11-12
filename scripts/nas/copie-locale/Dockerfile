# Copie locale de l'application et des données chiffrées sur le NAS (issue #143,
# docs/nas-copie-locale.md). Une image, deux services (docker-compose.yml) : « synchro » récupère le
# dépôt chaque nuit et reconstruit l'application, « web » la sert sur le réseau local.
# Node 22, comme la CI ; git pour cloner le dépôt public (sans jeton). Aucun secret dans l'image.
FROM node:22.11.0-alpine3.20

# tzdata: TZ (docker-compose.yml) sets the hour of the nightly synchro in local time
RUN apk add --no-cache git tzdata

# No COPY --chmod (BuildKit only): the modes are set here, whatever the upload kept of them.
COPY copie-locale.sh /usr/local/bin/copie-locale.sh
COPY serveur.mjs /usr/local/lib/copie-locale/serveur.mjs

# The image's « node » user (uid 1000), never root; /copie is the volume (docker-compose.yml).
RUN chmod 755 /usr/local/bin/copie-locale.sh && chmod 644 /usr/local/lib/copie-locale/serveur.mjs \
    && mkdir -p /copie && chown node:node /copie
USER node
WORKDIR /copie
ENV COPIE=/copie SITE=/copie/site PORT=8080 NPM_CONFIG_UPDATE_NOTIFIER=false

# Default: the nightly loop. The « web » service overrides it with the server.
CMD ["/usr/local/bin/copie-locale.sh", "boucle"]
