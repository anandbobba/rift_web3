from algopy import ARC4Contract, String, Account, BoxMap, Txn, arc4

class VeritasRegistry(ARC4Contract):
    def __init__(self) -> None:
        # BoxMap allows unlimited storage for all the hashes
        self.registered_hashes = BoxMap(String, Account)

    @arc4.abimethod
    def register_work(self, p_hash: String) -> String:
        # Check if the hash already exists using 'in' instead of '.contains()'
        assert p_hash not in self.registered_hashes, "Plagiarism Alert: Hash already registered!"
        
        # Store the hash and map it to the sender's account
        self.registered_hashes[p_hash] = Txn.sender
        
        return String("Artwork registered successfully.")
