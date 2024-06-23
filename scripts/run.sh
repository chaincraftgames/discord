#!/bin/bash

# Export all variables from .env
while read -r line; do export "$line"; done < ~/.env

# Execute your script in the pipenv environment
pipenv run python app.py