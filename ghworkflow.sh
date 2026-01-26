#!/usr/bin/env bash
# this script is called by github workflow after repository cloned to .solidbase dir.
# pushd ./.solidbase
# bash ghworkflow.sh
# popd

src_path="."
no_deploy=0

POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-deploy | -n)
      shift
      no_deploy=1
      ;;
    --src-path | -s)
      src_path="$2"
      shift
      shift
      if [[ ! -f "${src_path}/_config.yml" ]]; then
        echo "Source path does not contain _config.yml: ${src_path}_config.yml"
        exit 1
      fi
      ;;
    -* | --*)
      printf "%s\\n\\n" "Unrecognized option: $1"
      exit 1
      ;;
    *)
      POSITIONAL_ARGS+=("$1") # save positional arg
      shift # past argument
      ;;
  esac
done

set -- "${POSITIONAL_ARGS[@]}" # restore positional parameters

# download yq if not installed for windows/linux/macos
yq_bin_path="$(which yq)"
if ! command -v yq &> /dev/null; then
  echo "yq could not be found, installing..."
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    wget -qO- https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64.tar.gz | tar xz
    mv yq_linux_amd64 yq
    yq_bin_path="./yq"
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    wget -qO- https://github.com/mikefarah/yq/releases/latest/download/yq_darwin_amd64.tar.gz | tar xz
    mv yq_darwin_amd64 yq
    yq_bin_path="./yq"
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    # curl to download https://github.com/mikefarah/yq/releases/latest/download/yq_windows_amd64.zip
    curl -L -o yq_windows_amd64.zip https://github.com/mikefarah/yq/releases/latest/download/yq_windows_amd64.zip
    unzip yq_windows_amd64.zip
    mv yq_windows_amd64.exe yq.exe
    yq_bin_path="./yq.exe"
  fi
fi

# echo "Cleaning routes folder in examples in theme routes..."
rm -rf ./src/routes/*
cp -rp "${src_path}/_config.yml" ./

# 1. Copying included files from ../ to ./src/routes...
inclusion_list=$(${yq_bin_path} eval '.include[]' _config.yml)
exclusion_list=$(${yq_bin_path} eval '.exclude[]' _config.yml)
echo "Inclusion list: $inclusion_list"
echo "Exclusion list: $exclusion_list"

mkdir -p ./src/routes
cp -rp "${src_path}/index.md" ./src/routes/index.md 2>&1 1>/dev/null

for item in $inclusion_list; do
  cp -rfp "${src_path}/${item}" ./src/routes/${item}
done

for item in $exclusion_list; do
  rm -rf "./src/routes/${item}"
done

echo "Listing files in src/routes after include and exclude..."
ls -al ./src/routes/

# 2. npm install
echo "Installing npm dependencies..."
if [[ ! -d "node_modules" ]] || [[ ! -f "package-lock.json" ]]; then
  npm install
else
  echo "Dependencies already installed, skipping npm install..."
fi

# get site_url from _config.yml and echo to .env
site_url=$(${yq_bin_path} eval '.site_url' _config.yml)
if [ -n "$site_url" ]; then
  echo "VITE_SITE_URL=$site_url" > .env
fi

# 3. Building the project...
npx vinxi build

favicon_path=$(${yq_bin_path} eval '.site_favicon' _config.yml)
if [ -n "$favicon_path" ]; then
  # echo "Copying favicon from $favicon_path to ./.output/public/favicon.ico"
  cp -rp "${favicon_path}" ./.output/public/favicon.ico
fi

# 5. Copy resources to public
for item in $inclusion_list; do
  cp -rp "${src_path}/${item}" ./.output/public/
done

for item in $exclusion_list; do
  rm -rf "./.output/public/${item}"
done

ls -alth ./.output/public

# if run with --no-deploy, skip deployment
if [[ ${no_deploy} != 0 ]]; then
  echo "Skipping deployment as --no-deploy flag is set."
  exit 0
fi

# 6. Deployment
# if deployment provider is firebase, run firebase deploy
deployment_provider=$(${yq_bin_path} eval '.deployment.provider' _config.yml)

# if any of GITHUB_TOKEN CLOUDFLARE_PAGES_TOKEN FIREBASE_SERVICE_ACCOUNT_KEY exsits, do not source .secrets
if [ -z "$CLOUDFLARE_PAGES_TOKEN" ] && [ -z "$GITHUB_TOKEN" ] && [ -z "$FIREBASE_SERVICE_ACCOUNT_KEY" ]; then
  # source .secrets file if exists
  if [[ -f ".secrets" ]]; then
    echo "Sourcing .secrets file..."
    source ".secrets"
  elif [[ -f "../.secrets" ]]; then
    echo "Sourcing ../.secrets file..."
    source "../.secrets"
  else
    echo "No .secrets file found. Please create one with the required secrets."
    echo "Required secrets: CLOUDFLARE_PAGES_TOKEN || GITHUB_TOKEN || FIREBASE_SERVICE_ACCOUNT_KEY"
    exit 1
  fi
fi

if [ "$deployment_provider" == "firebase" ]; then
  # get FIREBASE_SERVICE_ACCOUNT_KEY from .secrets and get project and service_account_key_text from _config.yml
  # and replace FIREBASE_SERVICE_ACCOUNT_KEY from _config.yml with the value from .secrets
  firebase_project=$(${yq_bin_path} eval '.deployment.project' _config.yml)
  firebase_service_account_key=$(${yq_bin_path} eval '.deployment.service_account_key_text' _config.yml)
  if [ -z "$firebase_project" ]; then
    echo "Firebase project is not set. Please set it in _config.yml."
    exit 1
  fi
  if [ -n "$FIREBASE_SERVICE_ACCOUNT_KEY" ]; then
    echo "Using FIREBASE_SERVICE_ACCOUNT_KEY from environment variable."
    firebase_service_account_key=$FIREBASE_SERVICE_ACCOUNT_KEY
  fi
  if [ -z "$firebase_service_account_key" ]; then
    echo "Firebase service account key is not set. Please set it in _config.yml."
    exit 1
  fi

  echo "$FIREBASE_SERVICE_ACCOUNT_KEY" | base64 --decode > ./firebase-service-account_temp.json
  if ! command -v firebase &> /dev/null; then
    echo "Firebase CLI could not be found, installing..."
    npm install firebase-tools --save-dev
  fi

  cat > firebase.json << 'EOF'
{
  "hosting": {
    "site": "__SITE_NAME__",
    "cleanUrls": true,
    "public": ".output/public",
    "ignore": [
      "**/.*"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ],
    "headers": [
      {
        "source": "**/*.@(jpg|jpeg|gif|png)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "max-age=3600"
          }
        ]
      }
    ]
  }
}
EOF
  sed -i "s/__SITE_NAME__/${firebase_project}/g" firebase.json
  export GOOGLE_APPLICATION_CREDENTIALS="./firebase-service-account_temp.json"
  npx firebase deploy --only hosting --project "$firebase_project"
  rm ./firebase-service-account_temp.json
# elif [ "$deployment_provider" == "deno-deploy" ]; then
#   echo "Deploying to Deno Deploy..."
#   deno_deploy_token=$(${yq_bin_path} eval '.deployment.deno_deploy_token' _config.yml)
#   if [ -z "$deno_deploy_token" ]; then
#     echo "Deno Deploy token is not set. Please set it in _config.yml."
#     exit 1
#   fi
#   # check if deno is installed, if not, install it
#   if ! command -v deno &> /dev/null; then
#     echo "Deno could not be found, installing..."
#     npx --yes deno install -gArf jsr:@deno/deployctl
#   fi
#   npx deno deploy --project mdx-sitegen-solidbase --token "$deno_deploy_token" --config ./deno.json
elif [ "$deployment_provider" == "github-page" ]; then
  echo "Deploying to GitHub Pages..."

  if [[ "$GITHUB_ACTIONS" = "true" ]]; then
    echo "Running in GitHub Actions environment. Please use github actions to deploy."
    exit 1
  fi

  # 404 redirection. Copying 404.html to the public directory...
  rm -rf ./.output/public/404.html*
  # get 404_subsite_urls from _config.yml and replace _s=[]; line replace with _s=[ url1, url2, ...];
  subsite_urls=$(${yq_bin_path} eval '.404_subsite_urls[]' _config.yml | sed 's/.*/"&"/' | tr '\n' ',' | sed 's/,$//')
  sed -i "s|_s=\[\];|_s=[$subsite_urls];|" ./_404.html
  cp _404.html ./.output/public/404.html

  # get github_token from .secrets and get github_token and github_repo from _config.yml
  # and replace github_token from _config.yml with the value from .secrets
  github_token=$(${yq_bin_path} eval '.deployment.github_token' _config.yml)
  github_repo=$(${yq_bin_path} eval '.deployment.github_repo' _config.yml)
  if [ -z "$github_repo" ]; then
    echo "GitHub repository is not set. Please set it in _config.yml."
    exit 1
  fi
  if [ -n "$GITHUB_TOKEN" ]; then
    echo "Using GITHUB_TOKEN from environment variable."
    github_token=$GITHUB_TOKEN
  fi
  if [ -z "$github_token" ]; then
    echo "GitHub token is not set. Please set it in _config.yml."
    exit 1
  fi

  if ! command -v gh-pages &> /dev/null; then
    echo "gh-pages could not be found, installing..."
    npm install gh-pages --save-dev
  fi
  echo "Deploying to GitHub Pages... https://${github_token}@github.com/${github_repo}.git"
  npx gh-pages -d ./.output/public -r "https://${github_token}@github.com/${github_repo}.git" --branch gh-pages

elif [ "$deployment_provider" == "cloudflare-pages" ]; then
  echo "Deploying to Cloudflare Pages..."
  cloudflare_pages_token=$(${yq_bin_path} eval '.deployment.cloudflare_pages_token' _config.yml)
  cloudflare_project=$(${yq_bin_path} eval '.deployment.project' _config.yml)
  if [ -z "$cloudflare_project" ]; then
    echo "Cloudflare Pages project is not set. Please set it in _config.yml."
    exit 1
  fi
  if [ -n "$CLOUDFLARE_PAGES_TOKEN" ]; then
    echo "Using CLOUDFLARE_PAGES_TOKEN from environment variable."
    cloudflare_pages_token=$CLOUDFLARE_PAGES_TOKEN
  fi
  if [ -z "$cloudflare_pages_token" ]; then
    echo "Cloudflare Pages token is not set. Please set it in _config.yml."
    exit 1
  fi

  if ! command -v wrangler &> /dev/null; then
    echo "Wrangler could not be found, installing..."
    npm install wrangler --save-dev
  fi
  export CLOUDFLARE_API_TOKEN="$cloudflare_pages_token"
  npx wrangler pages deploy ./.output/public --project-name "$cloudflare_project" --branch main
else
  echo "Unknown deployment provider: $deployment_provider"
  exit 1
fi
