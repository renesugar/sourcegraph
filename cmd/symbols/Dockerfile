FROM alpine:3.9 AS libsqlite3-pcre

# hadolint ignore=DL3003,DL3018,DL4006
RUN apk --no-cache add --virtual build-deps curl git gcc make libc-dev pcre-dev sqlite-dev && \
  mkdir /sqlite3-pcre && \
  curl -fsSL https://codeload.github.com/ralight/sqlite3-pcre/tar.gz/c98da412b431edb4db22d3245c99e6c198d49f7a | tar -C /sqlite3-pcre -xzvf - --strip 1 && \
  cd /sqlite3-pcre && \
  make && \
  apk --no-cache --purge del build-deps

FROM alpine:3.9

# hadolint ignore=DL3018
RUN apk add --no-cache bind-tools ca-certificates mailcap tini

# hadolint ignore=DL3022
COPY --from=ctags /usr/local/bin/universal-* /usr/local/bin/

COPY --from=libsqlite3-pcre /sqlite3-pcre/pcre.so /libsqlite3-pcre.so
ENV LIBSQLITE3_PCRE /libsqlite3-pcre.so
# hadolint ignore=DL3018
RUN apk --no-cache add pcre-dev

# universal-ctags doesn't support some popular languages out of the box (Scala,
# Swift, and Haskell, to name a few). However, you can add language support by
# providing regexes on the command line or in a configuration file.
# universal-ctags looks in the current working directory for config files during
# initialization:
# https://github.com/universal-ctags/ctags/blob/1b747b38589f7a1c98ac9fe0a0b8b174dd476050/docs/optlib.rst#preload-option-file
WORKDIR /
COPY .ctags.d /.ctags.d

ENV CACHE_DIR=/mnt/cache/symbols
EXPOSE 3184
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/symbols"]
COPY symbols /usr/local/bin/
