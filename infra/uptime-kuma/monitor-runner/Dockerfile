FROM mcr.microsoft.com/playwright:v1.58.2-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash

ENV BUN_INSTALL=/root/.bun
ENV PATH=/root/.bun/bin:${PATH}

WORKDIR /workspace/app

COPY infra/uptime-kuma/monitor-runner/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
