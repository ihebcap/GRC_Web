using Ninject;
using Ninject.Modules;

namespace GRC.Infrastructure.Tresorerie;

/// <summary>
/// Remplace Tresorerie.IoC.Core.Dapper.Mssql.TresorerieCoreModule.
/// Reproduit tous les bindings sans Ninject.Extensions.Factory / Castle.DynamicProxy.
/// </summary>
public sealed class TresorerieCoreDapperReplacementModule : NinjectModule
{
    public override string Name => nameof(TresorerieCoreDapperReplacementModule);

    public override void Load()
    {
        Rebind<global::Tresorerie.Core.Interfaces.IConnectionProvider>().To<global::Tresorerie.Dapper.ConnectionProvider>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IReleveClientRepository>().To<global::Tresorerie.Dapper.Repositories.ReleveClientRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IDossierImpayeRepository>().To<global::Tresorerie.Dapper.Repositories.DossierImpayeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IGarentieRepository>().To<global::Tresorerie.Dapper.Repositories.GarantieRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ICreditRepository>().To<global::Tresorerie.Dapper.Repositories.CreditRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IGarentieCreditRepository>().To<global::Tresorerie.Dapper.Repositories.GarentieCreditRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneCreditRepository>().To<global::Tresorerie.Dapper.Repositories.LigneCreditRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ICommissionImpayeRepository>().To<global::Tresorerie.Dapper.Repositories.CommissionImpayeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IInteretImpayeRepository>().To<global::Tresorerie.Dapper.Repositories.InteretImpayeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneDossierImpayeRepository>().To<global::Tresorerie.Dapper.Repositories.LigneDossierImpayeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IExtraitBancaireRepository>().To<global::Tresorerie.Dapper.Repositories.ExtraitBancaireRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ICautionRepository>().To<global::Tresorerie.Dapper.Repositories.CautionRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IChequeEntityRepository>().To<global::Tresorerie.Dapper.Repositories.ChequeEntityRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ITypeCautionRepository>().To<global::Tresorerie.Dapper.Repositories.TypeCautionRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ITypeCreditRepository>().To<global::Tresorerie.Dapper.Repositories.TypeCreditRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IDeviseRepository>().To<global::Tresorerie.Dapper.Repositories.DeviseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IPaysRepository>().To<global::Tresorerie.Dapper.Repositories.PaysRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IModeReglementRepository>().To<global::Tresorerie.Dapper.Repositories.ModeReglementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ICaisseRepository>().To<global::Tresorerie.Dapper.Repositories.CaisseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ICaisseCaisseRepository>().To<global::Tresorerie.Dapper.Repositories.CaisseCaisseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ICaisseBanqueRepository>().To<global::Tresorerie.Dapper.Repositories.CaisseBanqueRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISocieteRepository>().To<global::Tresorerie.Dapper.Repositories.SocieteRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.IGroupeService>().To<global::Tresorerie.Core.Services.GroupeService>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.NotifyService>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.INotificationRepository>().To<global::Tresorerie.Dapper.Repositories.NotificationRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISubscriberRepository>().To<global::Tresorerie.Dapper.Repositories.SubscriberRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ITypeBordereauRepository>().To<global::Tresorerie.Dapper.Repositories.TypeBordereauRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneBordereauRepository>().To<global::Tresorerie.Dapper.Repositories.LigneBordereauRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneBordereauVirementRepository>().To<global::Tresorerie.Dapper.Repositories.LigneBordereauVirementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IUtilisateurRepository>().To<global::Tresorerie.Dapper.Repositories.UtilisateurRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IUserPasswordRepository>().To<global::Tresorerie.Dapper.Repositories.UserPasswordRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISocieteDeviseRepository>().To<global::Tresorerie.Dapper.Repositories.SocieteDeviseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISocieteImpressionRepository>().To<global::Tresorerie.Dapper.Repositories.SocieteImpressionRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISocieteSoucheRepository>().To<global::Tresorerie.Dapper.Repositories.SocieteSoucheRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ICaisseModeReglementRepository>().To<global::Tresorerie.Dapper.Repositories.CaisseModeReglementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IReglementClientRepository>().To<global::Tresorerie.Dapper.Repositories.ReglementClientRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IReglementClientRemplaceRepository>().To<global::Tresorerie.Dapper.Repositories.ReglementClientRemplaceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISocieteModeReglementRepository>().To<global::Tresorerie.Dapper.Repositories.SocieteModeReglementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IEcheanceRepository>().To<global::Tresorerie.Dapper.Repositories.EcheanceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IAffectationRepository>().To<global::Tresorerie.Dapper.Repositories.AffectationRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IBordereauRepository>().To<global::Tresorerie.Dapper.Repositories.BordereauRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IBordereauVirementRepository>().To<global::Tresorerie.Dapper.Repositories.BordereauVirementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IHistoriqueMvtRepository>().To<global::Tresorerie.Dapper.Repositories.HistoriqueMvtRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ITransfertRepository>().To<global::Tresorerie.Dapper.Repositories.TransfertRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IMouvementRepository>().To<global::Tresorerie.Dapper.Repositories.MouvementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IImpayeRepository>().To<global::Tresorerie.Dapper.Repositories.ImpayeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IRemplacementRepository>().To<global::Tresorerie.Dapper.Repositories.RemplacementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISocTypeBordereauRepository>().To<global::Tresorerie.Dapper.Repositories.SocTypeBordereauRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IMouvmentBancaireRepository>().To<global::Tresorerie.Dapper.Repositories.MouvementBancaireRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IMouvementCaisseRepository>().To<global::Tresorerie.Dapper.Repositories.MouvementCaisseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISolvabiliteClientRepository>().To<global::Tresorerie.Dapper.Repositories.SolvabiliteClientRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IEngagementClientRepository>().To<global::Tresorerie.Dapper.Repositories.EngagementClientRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Models.IEngagementClientDetailsRepository>().To<global::Tresorerie.Dapper.Repositories.EngagementClientDetailsRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneEngagementClientRepository>().To<global::Tresorerie.Dapper.Repositories.LigneEngagementClientRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IBanqueTiersRepository>().To<global::Tresorerie.Dapper.Repositories.BanqueTiersRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISocieteUtilisateurRepository>().To<global::Tresorerie.Dapper.Repositories.SocieteUtilisateurRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IAutorisationCaisseRepository>().To<global::Tresorerie.Dapper.Repositories.AutorisationCaisseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IAutorisationSoucheRepository>().To<global::Tresorerie.Dapper.Repositories.AutorisationSoucheRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IStructureVirementRepository>().To<global::Tresorerie.Dapper.Repositories.StructureVirementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.INoteRepository>().To<global::Tresorerie.Dapper.Repositories.NoteRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILockRepository>().To<global::Tresorerie.Dapper.Repositories.LockRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.ILock>().To<global::Tresorerie.Core.Services.LockService>();
        Rebind<global::Tresorerie.Core.Interfaces.IEcritureComptaRepository>().To<global::Tresorerie.Dapper.Repositories.HistoriqueComptaRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IGridLayoutRepository>().To<global::Tresorerie.Dapper.Repositories.GridLayoutRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IGridLayoutFilterRepository>().To<global::Tresorerie.Dapper.Repositories.GridLayoutFilterRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IUtilisateurGridRepository>().To<global::Tresorerie.Dapper.Repositories.UtilisateurGridRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Dapper.IRepositoryFactory>().To<NinjectRepositoryFactory>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IReglementFournisseurRepository>().To<global::Tresorerie.Dapper.Repositories.ReglementFournisseurRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IDossierReglementRepository>().To<global::Tresorerie.Dapper.Repositories.DossierReglementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IAnnexeRepository>().To<global::Tresorerie.Dapper.Repositories.AnnexeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneDossierReglementRepository>().To<global::Tresorerie.Dapper.Repositories.LigneDossierReglementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IChequierRepository>().To<global::Tresorerie.Dapper.Repositories.ChequierRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IChequeRepository>().To<global::Tresorerie.Dapper.Repositories.ChequeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IAlimentationCaisseRepository>().To<global::Tresorerie.Dapper.Repositories.AlimentationCaisseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IRetenuALaSourceRepository>().To<global::Tresorerie.Dapper.Repositories.RetenueALaSourceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISecuriteRepository>().To<global::Tresorerie.Dapper.Repositories.SecuriteRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ITypeDepenseRepository>().To<global::Tresorerie.Dapper.Repositories.TypeDepenseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IMouvementDepenseRepository>().To<global::Tresorerie.Dapper.Repositories.MouvementDepenseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IMouvementCaisseEspeceRepository>().To<global::Tresorerie.Dapper.Repositories.MouvementCaisseEspeceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IVerifyLotEspeceRepository>().To<global::Tresorerie.Dapper.Repositories.VerifyLotEspeceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IVerifySoldeCaisseRepository>().To<global::Tresorerie.Dapper.Repositories.VerifySoldeCaisseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IVerifySoldeEcheanceRepository>().To<global::Tresorerie.Dapper.Repositories.VerifySoldeEcheanceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IVerifySoldeReglementClientRepository>().To<global::Tresorerie.Dapper.Repositories.VerifySoldeReglementClientRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IVerifySoldeReglementToReplaceRepository>().To<global::Tresorerie.Dapper.Repositories.VerifySoldeReglementToReplaceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IInformationsBanqueRepository>().To<global::Tresorerie.Dapper.Repositories.InformationsBanqueRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IMouvementEscompteRepository>().To<global::Tresorerie.Dapper.Repositories.MouvementEscompteRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IEcartRepository>().To<global::Tresorerie.Dapper.Repositories.EcartRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IEcartEchangeRepository>().To<global::Tresorerie.Dapper.Repositories.EcartEchangeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IVirementInterneRepository>().To<global::Tresorerie.Dapper.Repositories.VirementInterneRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IVirementTiersRepository>().To<global::Tresorerie.Dapper.Repositories.VirementTiersRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneVirementTiersRepository>().To<global::Tresorerie.Dapper.Repositories.LigneVirementTiersRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IRemboursementClientRepository>().To<global::Tresorerie.Dapper.Repositories.RemboursementClientRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IRemboursementFournisseurRepository>().To<global::Tresorerie.Dapper.Repositories.RemboursementFournisseurRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IRemboursementClientAllTypeRepository>().To<global::Tresorerie.Dapper.Repositories.RemboursementClientAllTypeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILettrageAffectationRepository>().To<global::Tresorerie.Dapper.Repositories.LettrageAffectationRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IDossierCommunRepository>().To<global::Tresorerie.Dapper.Repositories.DossierCommunRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IPrevisionnelleRepository>().To<global::Tresorerie.Dapper.Repositories.PrevisionnelleRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ITypePrevisionRepository>().To<global::Tresorerie.Dapper.Repositories.TypePrevisionRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ITypeOperationBancaireRepository>().To<global::Tresorerie.Dapper.Repositories.TypeOperartionBancaireRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IImpayeFournisseurRepository>().To<global::Tresorerie.Dapper.Repositories.ImpayeFournisseurRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IRecapTiersRepository>().To<global::Tresorerie.Dapper.Repositories.RecapTiersRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IRappelRepository>().To<global::Tresorerie.Dapper.Repositories.RappelRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneRappelRepository>().To<global::Tresorerie.Dapper.Repositories.LigneRappelRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IDetailHistoriqueRappelEcheanceRepository>().To<global::Tresorerie.Dapper.Repositories.DetailHistoriqueRappelEcheanceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneDossierReglementCommRepository>().To<global::Tresorerie.Dapper.Repositories.LigneDossierReglementCommRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneFactureRepository>().To<global::Tresorerie.Dapper.Repositories.LigneFactureRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IFactureRepository>().To<global::Tresorerie.Dapper.Repositories.FactureRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IVentilationAnalytiqueRepository>().To<global::Tresorerie.Dapper.Repositories.VentilationAnalytiqueRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneClotureCaisseRepository>().To<global::Tresorerie.Dapper.Repositories.LigneClotureCaisseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IClotureCaisseRepository>().To<global::Tresorerie.Dapper.Repositories.ClotureCaisseRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IViewTiersRepository>().To<global::Tresorerie.Dapper.Repositories.ViewTiersRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IPropertyExtensionProvider>().To<global::Tresorerie.Dapper.DbProperties.PropertyExtensionProvider>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IBalanceAgeeRepository>().To<global::Tresorerie.Dapper.Repositories.BalanceAgeeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IDetailAffectationRepository>().To<global::Tresorerie.Dapper.Repositories.DetailAffectationRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IParametreMailRepository>().To<global::Tresorerie.Dapper.Repositories.ParametreMailRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ICaisseAuthorisation>().To<global::Tresorerie.Dapper.Repositories.CaisseAuthorisationRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IReglementCoffreRepository>().To<global::Tresorerie.Dapper.Repositories.ReglementCoffreRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IFourchetteCommissionRepository>().To<global::Tresorerie.Dapper.Repositories.FourchetteCommissionRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IInformationLibreRepository>().To<global::Tresorerie.Dapper.Repositories.InformationLibreRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IInformationLibreGrfRepository>().To<global::Tresorerie.Dapper.Repositories.InformationLibreGrfRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IConfigConnectionErpExternRepository>().To<global::Tresorerie.Dapper.Repositories.ConfigConnectionErpExternRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IEngagementFournisseurRepository>().To<global::Tresorerie.Dapper.Repositories.EngagementFournisseurRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IDeclarationTvaEncaissementRepository>().To<global::Tresorerie.Dapper.Repositories.DeclarationTvaEncaissementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IDeclarationDelaisPaiementRepository>().To<global::Tresorerie.Dapper.Repositories.DeclarationDelaisPaiementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneDeclarationDelaisPaiementRepository>().To<global::Tresorerie.Dapper.Repositories.LigneDeclarationDelaisPaiementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Dapper.Repositories.IOperationRetenuSourceRepository>().To<global::Tresorerie.Dapper.Repositories.OperationRetenuSourceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneDeclarationTvaEncaissementRepository>().To<global::Tresorerie.Dapper.Repositories.LigneDeclarationTvaEncaissementRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneDeclarationRetenuSourceRepository>().To<global::Tresorerie.Dapper.Repositories.LigneDeclarationRetenuSourceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILettreRecouvrementFieldsRepository>().To<global::Tresorerie.Dapper.Repositories.LettreRecouvrementFieldsRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ICodeActiviteRepository>().To<global::Tresorerie.Dapper.Repositories.CodeActiviteRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISocieteCodeActiviteTaxeRepository>().To<global::Tresorerie.Dapper.Repositories.SocieteCodeActiviteTaxeRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISocieteCodeActiviteTiersRepository>().To<global::Tresorerie.Dapper.Repositories.SocieteCodeActiviteTiersRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IAttestationRetenueTiersRepository>().To<global::Tresorerie.Dapper.Repositories.AttestationRetenueTiersRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ITiersServiceContactRepository>().To<global::Tresorerie.Dapper.Repositories.TiersServiceContactRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IDesignationDocumentRepository>().To<global::Tresorerie.Dapper.Repositories.DesignationDocumentRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISocieteDesignationDocumentRepository>().To<global::Tresorerie.Dapper.Repositories.SocieteDesignationDocumentRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IRegleRetenueSourceTvaRepository>().To<global::Tresorerie.Dapper.Repositories.RegleRetenueSourceTvaRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILigneDossierEcheanceTvaNonRecuperableRepository>().To<global::Tresorerie.Dapper.Repositories.LigneDossierEcheanceTvaNonRecuperableRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ICarnetTraiteRepository>().To<global::Tresorerie.Dapper.Repositories.CarnetTraiteRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ITraiteRepository>().To<global::Tresorerie.Dapper.Repositories.TraiteRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IWorkerRepository>().To<global::Tresorerie.Dapper.Repositories.WorkerRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ISolvabiliteFournisseurRepository>().To<global::Tresorerie.Dapper.Repositories.SolvabiliteFournisseurRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IDeclarationRetenuSourceRepository>().To<global::Tresorerie.Dapper.Repositories.DeclarationRetenuSourceRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IJoursReposRepository>().To<global::Tresorerie.Dapper.Repositories.JoursReposRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IConventionDelaisPaiementTiersRepository>().To<global::Tresorerie.Dapper.Repositories.ConventionDelaisPaiementTiersRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IWorkflowHistoryRepository>().To<global::Tresorerie.Dapper.Repositories.WorkflowHistoryRepository>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.InformationBanqueManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.CreditManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.CaisseManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.WorkerManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.DeviseManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.HistoriqueMvtManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.ModeReglementManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.SocieteManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.TransfertManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.TypeBordereauxManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.DepenseManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.AlimentationCaisseManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.UtilisateurManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.VerifySoldeManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.IValidator<global::Tresorerie.Core.Models.BanqueTiers>>().To<global::Tresorerie.Core.Services.BanqueTiersValidator>().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.BanqueTiersManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.PrevisionnelManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.CodeActiviteManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.DesignationDocumentManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Services.RegleRetenueSourceTvaManager>().ToSelf().InSingletonScope();
        Rebind<global::Tresorerie.Core.Interfaces.ILibelleComptaGenerator>().To<global::Tresorerie.Core.Services.LibelleComptaGenerator>();
        Rebind<global::Tresorerie.Core.Interfaces.ILibelleComptaFormuleRunner>().To<global::Tresorerie.Core.Services.LibelleComptaFormuleRunner>();
        Rebind<global::Tresorerie.Core.Interfaces.IFormuleProvider>().To<global::Tresorerie.Core.Services.FormuleProvider>();
    }
}

// --- Factory IRepositoryFactory (remplace ToFactory<IRepositoryFactory>) ---

public sealed class NinjectRepositoryFactory : global::Tresorerie.Dapper.IRepositoryFactory
{
    private readonly IKernel _kernel;
    public NinjectRepositoryFactory(IKernel kernel) => _kernel = kernel;
    public T Create<T>()
        where T : global::Tresorerie.Dapper.BaseRepository
        => _kernel.Get<T>();
}
