"""Reference implementation of the SAS-over-REST send that specs/cope-service-bus-sas.feature automates.

The bulk-send-key primary key is read from the environment so it is never committed:
    setx SERVICE_BUS_SAS_KEY "<primary key from cope-pocsb > cope-requests > bulk-send-key>"
"""

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.parse

import requests

NAMESPACE = os.environ.get("SERVICE_BUS_NAMESPACE", "cope-pocsb")
QUEUE_NAME = os.environ.get("COPE_QUEUE_NAME", "cope-requests")
POLICY_NAME = os.environ.get("SERVICE_BUS_SAS_KEY_NAME", "bulk-send-key")
POLICY_KEY = os.environ["SERVICE_BUS_SAS_KEY"]
CORRELATION_ID = os.environ.get("COPE_CORRELATION_ID", "caf-prospect-sas-rest")


def generate_sas_token(resource_uri: str, key_name: str, key: str, expiry_seconds: int = 3600) -> str:
    expiry = int(time.time() + expiry_seconds)
    encoded_uri = urllib.parse.quote_plus(resource_uri)
    string_to_sign = f"{encoded_uri}\n{expiry}".encode("utf-8")

    signature = base64.b64encode(
        hmac.new(key.encode("utf-8"), string_to_sign, hashlib.sha256).digest()
    )
    signature_encoded = urllib.parse.quote_plus(signature.decode("utf-8"))
    return f"SharedAccessSignature sr={encoded_uri}&sig={signature_encoded}&se={expiry}&skn={key_name}"



payload = {
    "requestMetadata": {
        "correlationId": CORRELATION_ID,
        "sourceSystem": "CaffeineCRM",
        "requestTimestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    },
    "propertyAddress": {
        "line1": "4529 Winona Ct",
        "line2": "",
        "city": "Denver",
        "state": "CO",
        "zipCode": "80222",
    },
}

resource_uri = f"https://{NAMESPACE}.servicebus.windows.net/{QUEUE_NAME}"
sas_token = generate_sas_token(resource_uri, POLICY_NAME, POLICY_KEY)

response = requests.post(
    f"{resource_uri}/messages",
    headers={
        "Authorization": sas_token,
        "Content-Type": "application/json",
        # messageId / correlationId travel in BrokerProperties, not in the body.
        "BrokerProperties": json.dumps(
            {"MessageId": CORRELATION_ID, "CorrelationId": CORRELATION_ID}
        ),
    },
    params={"timeout": 60, "api-version": "2021-05"},
    data=json.dumps(payload),
    timeout=60,
)
print(response.status_code, response.text)
