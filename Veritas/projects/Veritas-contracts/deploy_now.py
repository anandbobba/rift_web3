from algokit_utils import AlgorandClient

def main():
    print("Connecting to LocalNet...")
    algorand = AlgorandClient.default_localnet()
    deployer = algorand.account.localnet_dispenser()
    
    print("Deploying Veritas Registry...")
    with open("smart_contracts/artifacts/veritas_registry/VeritasRegistry.arc56.json", "r") as f:
        app_spec = f.read()
        
    app_factory = algorand.client.get_app_factory(
        app_spec=app_spec,
        default_sender=deployer.address,
        default_signer=deployer.signer,
    )
    
    app_client, _ = app_factory.deploy(
        on_schema_break="append",
        on_update="append",
    )
    
    print("\n" + "="*40)
    print("🚀 VERITAS REGISTRY SUCCESSFULLY DEPLOYED!")
    print(f"🔥 APP ID: {app_client.app_id}")
    print("="*40 + "\n")

if __name__ == "__main__":
    main()
