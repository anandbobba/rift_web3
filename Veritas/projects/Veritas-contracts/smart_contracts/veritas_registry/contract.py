from algopy import ARC4Contract, String, Account, Txn, BoxMap, arc4
from algopy.arc4 import abimethod


class Registration(arc4.Event):
    owner: Account
    p_hash: String


class VeritasRegistry(ARC4Contract):
    def __init__(self) -> None:
        self.registered_hashes = BoxMap(String, Account)

    @abimethod()
    def register_work(self, p_hash: String) -> None:
        """Registers a visual fingerprint on-chain."""
        assert p_hash not in self.registered_hashes, "Hash already registered"
        
        # Store the sender as the owner of this fingerprint in the box storage
        self.registered_hashes[p_hash] = Txn.sender
        
        # Emit an event for indexing/frontend purposes
        arc4.emit(Registration(owner=Txn.sender, p_hash=p_hash))

    @abimethod()
    def hello(self, name: String) -> String:
        return "Hello, " + name
