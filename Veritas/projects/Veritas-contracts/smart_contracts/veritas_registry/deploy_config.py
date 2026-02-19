import logging
import algokit_utils
from algosdk.v2client.algod import AlgodClient
from algosdk.v2client.indexer import IndexerClient

logger = logging.getLogger(__name__)

def deploy(
    algod_client: AlgodClient,
    indexer_client: IndexerClient,
    app_spec: algokit_utils.ApplicationSpecification,
    deployer: algokit_utils.Account,
) -> None:
    from smart_contracts.artifacts.veritas_registry.veritas_registry_client import (
        VeritasRegistryClient,
    )

    # Initialize the client for your specific Veritas contract
    app_client = VeritasRegistryClient(
        algod_client,
        creator=deployer,
        indexer_client=indexer_client,
    )

    # Deploy the contract to the blockchain
    app_client.deploy(
        on_schema_break=algokit_utils.OnSchemaBreak.AppendApp,
        on_update=algokit_utils.OnUpdate.AppendApp,
    )
    
    logger.info(f"🚀 Veritas Registry successfully deployed!")
    logger.info(f"App ID: {app_client.app_id}")
