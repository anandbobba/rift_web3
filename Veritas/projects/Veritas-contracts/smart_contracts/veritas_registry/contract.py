from algopy import ARC4Contract, String, Account, BoxMap, Txn, arc4

class VeritasRegistry(ARC4Contract):
    def __init__(self) -> None:
        self.registered_hashes = BoxMap(String, Account)

    @arc4.abimethod
    def register_work(self, p_hash: String) -> None:
        assert p_hash not in self.registered_hashes, "Plagiarism Alert: Hash already registered!"
        self.registered_hashes[p_hash] = Txn.sender
