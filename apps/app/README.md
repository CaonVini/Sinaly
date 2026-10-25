# App do cidadão (Expo)

Telas: cadastro/login → onboarding (nome, celular, CPF, endereço com CEP automático) → abas **Mapa**, **Meus relatos**, **Avisos** e **Perfil**, mais **Novo relato** (local no mapa, categoria, descrição, foto) e **Detalhes** (foto, andamento e comentários da prefeitura).

Regras do mapa (as mesmas da API): aparecem as ocorrências aprovadas; as resolvidas somem depois de 5 dias (o filtro "Resolvidas: todas" traz de volta); as suas ainda não verificadas aparecem só para você, com contorno tracejado.

## Testar no celular com o Expo Go (mais rápido)

1. Instale o **Expo Go** (Play Store / App Store) e deixe atualizado: este projeto usa o **SDK 58**.
2. PC e celular na **mesma rede Wi-Fi**. Wi-Fi de universidade costuma isolar os aparelhos; se não conectar, ligue o PC no roteador do celular.
3. API rodando no PC (`docker compose up -d`) — ela já escuta em todas as interfaces na porta 3333.
4. Na raiz do repositório:
   ```bash
   pnpm install
   pnpm dev:app
   ```
5. Leia o QR code com o Expo Go (Android) ou com a câmera (iPhone).

O app descobre sozinho o endereço da API: usa o mesmo IP do PC de onde baixou o código, na porta 3333. Em modo desenvolvimento esse endereço aparece no rodapé da tela de login.

### Se não conectar (Windows)

- **Firewall**: no PowerShell como administrador, libere as portas do Metro e da API só para redes privadas:
  ```powershell
  New-NetFirewallRule -DisplayName "Sinaly Expo 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow -Profile Private
  New-NetFirewallRule -DisplayName "Sinaly API 3333" -Direction Inbound -Protocol TCP -LocalPort 3333 -Action Allow -Profile Private
  ```
  E confira se o Wi-Fi está como **rede privada** (Configurações → Rede → Propriedades).
- **IP errado no QR** (Docker/WSL criam placas de rede virtuais): descubra o IP do Wi-Fi com `ipconfig` e force:
  ```powershell
  $env:REACT_NATIVE_PACKAGER_HOSTNAME="192.168.0.15"; pnpm dev:app
  ```
- Teste no navegador do celular: `http://IP-DO-PC:3333/health` deve responder `{"status":"ok"}`.

## Gerar APK para instalar (EAS)

```bash
npm i -g eas-cli && eas login
cd apps/app && eas build -p android --profile preview
```

O APK precisa de uma **chave do Google Maps** para Android (Google Cloud → Maps SDK for Android; a cota gratuita cobre a demo). Configure em `app.json` → `android.config.googleMaps.apiKey` via variável de ambiente do EAS, nunca commitada. No Expo Go não precisa.

E de uma API em **HTTPS** (o Android bloqueia HTTP em app instalado): defina `EXPO_PUBLIC_API_URL` com o domínio do servidor ou um túnel HTTPS (ex.: `cloudflared tunnel --url http://localhost:3333`).

## Decisões técnicas

| Ponto | Escolha | Por quê |
| --- | --- | --- |
| Mapa | Nativo (`react-native-maps`: Google Maps no Android, Apple Maps no iOS) | Rolagem e zoom a 60 fps, sem baixar biblioteca de CDN a cada abertura |
| Navegação | Navegador próprio (abas + pilha) | Poucas telas; evita duas dependências nativas |
| Sessão | Access token só em memória; refresh token no SecureStore (Keychain/Keystore) | Token longo nunca fica em texto puro no aparelho |
| Fotos | Reduzidas para 1600 px e JPEG 70% no aparelho | Upload rápido no 4G, sem EXIF (GPS, modelo do celular) |
| Avisos | Consulta leve a cada 60 s com o app aberto | Push em tempo real está fora do MVP |
